const pool = require('../db');

// Reusable logger
async function logCRMAction(userId, customerId, action, details) {
  await pool.query(
    `INSERT INTO crm_logs (user_id, customer_id, action, details) VALUES ($1, $2, $3, $4)`,
    [userId, customerId, action, details]
  );
}

// Get customers visible to current user
async function getCustomers(req, res) {
  const user = req.user;

  try {
    let result;

    if (user.role === 'super_admin') {
      result = await pool.query(`
        SELECT 
          c.*, 
          latest_stage.stage AS current_stage, 
          ARRAY_AGG(a.user_id) AS assigned_user_ids,
          ARRAY_AGG(u.name) AS assigned_user_names
        FROM customers c
        LEFT JOIN LATERAL (
          SELECT stage
          FROM sales_pipeline
          WHERE customer_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
        ) latest_stage ON true
        LEFT JOIN customer_assignments a ON c.id = a.customer_id
        LEFT JOIN users u ON a.user_id = u.id
        GROUP BY c.id, latest_stage.stage
        ORDER BY c.created_at DESC
      `);
    } else {
      result = await pool.query(`
        SELECT 
          c.*, 
          latest_stage.stage AS current_stage, 
          ARRAY_AGG(a.user_id) AS assigned_user_ids,
          ARRAY_AGG(u.name) AS assigned_user_names
        FROM customers c
        LEFT JOIN LATERAL (
          SELECT stage
          FROM sales_pipeline
          WHERE customer_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
        ) latest_stage ON true
        LEFT JOIN customer_assignments a ON c.id = a.customer_id
        LEFT JOIN users u ON a.user_id = u.id
        WHERE a.user_id = $1
        GROUP BY c.id, latest_stage.stage
        ORDER BY c.created_at DESC
      `, [user.id]);
    }

    res.status(200).json({ customers: result.rows });
  } catch (err) {
    console.error('Fetch customers failed:', err);
    res.status(500).json({ error: 'Failed to load customers' });
  }
}

async function searchCustomers(req, res) {
  const user = req.user;
  const { search } = req.query;

  try {
    const searchTerm = `%${search || ''}%`;

    let result;
    if (user.role === 'super_admin') {
      result = await pool.query(
        `SELECT id, name FROM customers WHERE name ILIKE $1 ORDER BY name LIMIT 10`,
        [searchTerm]
      );
    } else {
      result = await pool.query(
        `SELECT c.id, c.name
         FROM customers c
         JOIN customer_assignments a ON c.id = a.customer_id
         WHERE a.user_id = $1 AND c.name ILIKE $2
         ORDER BY c.name
         LIMIT 10`,
        [user.id, searchTerm]
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Search failed:', err);
    res.status(500).json({ error: 'Failed to search customers' });
  }
}


// Create new customer and auto-assign creator
async function createCustomer(req, res) {
  const { name, company, email, phone, status, notes } = req.body;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `INSERT INTO customers (name, company, email, phone, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, company, email, phone, status || 'lead', notes, userId]
    );

    const customer = result.rows[0];

    // Auto-assign creator
    await pool.query(
      `INSERT INTO customer_assignments (customer_id, user_id) VALUES ($1, $2)`,
      [customer.id, userId]
    );

    await logCRMAction(userId, customer.id, 'created_customer', `Created customer '${name}'`);

    res.status(201).json({ customer });
  } catch (err) {
    console.error('Error creating customer:', err);
    res.status(500).json({ error: 'Failed to create customer' });
  }
}

// Edit customer info
async function updateCustomer(req, res) {
  const customerId = req.params.id;
  const user = req.user;
  const { name, company, email, phone, status, notes } = req.body;

  try {
    // Check if user has access
    const check = await pool.query(`
      SELECT 1 FROM customer_assignments WHERE customer_id = $1 AND user_id = $2
    `, [customerId, user.id]);

    if (user.role !== 'super_admin' && check.rowCount === 0) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await pool.query(
      `UPDATE customers
       SET name = $1, company = $2, email = $3, phone = $4, status = $5, notes = $6
       WHERE id = $7`,
      [name, company, email, phone, status, notes, customerId]
    );

    await logCRMAction(user.id, customerId, 'updated_customer', `Updated customer '${name}'`);
    res.json({ message: 'Customer updated' });
  } catch (err) {
    console.error('Error updating customer:', err);
    res.status(500).json({ error: 'Failed to update customer' });
  }
}

// Assign customer to a user (super admin only)
async function assignCustomer(req, res) {
  const customerId = req.params.id;
  const { user_ids } = req.body; // expects array
  const adminId = req.user.id;

  if (!Array.isArray(user_ids)) {
    return res.status(400).json({ error: 'user_ids must be an array' });
  }

  try {
    await pool.query('BEGIN');
    await pool.query(`DELETE FROM customer_assignments WHERE customer_id = $1`, [customerId]);

    for (const uid of user_ids) {
      if (!uid) continue; // skip null/undefined
      await pool.query(`
        INSERT INTO customer_assignments (customer_id, user_id)
        VALUES ($1, $2)
      `, [customerId, uid])
    }

    await logCRMAction(adminId, customerId, 'updated_assignments', `Assigned users: ${user_ids.join(', ')}`);
    await pool.query('COMMIT');
    res.json({ message: 'Assignments updated' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error bulk assigning:', err);
    res.status(500).json({ error: 'Assignment failed' });
  }
}

// Unassign user from customer
async function unassignCustomer(req, res) {
  const customerId = req.params.id;
  const { user_id } = req.body;
  const adminId = req.user.id;

  try {
    await pool.query(
      `DELETE FROM customer_assignments WHERE customer_id = $1 AND user_id = $2`,
      [customerId, user_id]
    );

    await logCRMAction(adminId, customerId, 'unassigned_customer', `Unassigned user ID ${user_id}`);
    res.json({ message: 'User unassigned' });
  } catch (err) {
    console.error('Error unassigning:', err);
    res.status(500).json({ error: 'Unassignment failed' });
  }
}

// Fetch logs for a given customer
async function getLogs(req, res) {
  const customerId = req.params.id;
  const user = req.user;

  try {
    // Fetch assigned rep IDs for this customer
    const assignmentRes = await pool.query(
      `SELECT ARRAY_AGG(user_id) AS assigned
       FROM customer_assignments
       WHERE customer_id = $1`,
      [customerId]
    );

    const assignedIds = assignmentRes.rows[0]?.assigned || [];

    // Restrict access to super admin OR assigned rep
    const isAssigned = assignedIds.includes(user.id);
    if (user.role !== 'super_admin' && !isAssigned) {
      return res.status(403).json({ error: 'Forbidden: Not assigned to customer' });
    }

    // Fetch the logs
    const result = await pool.query(
      `
      SELECT l.*, u.name AS user_name
      FROM crm_logs l
      JOIN users u ON l.user_id = u.id
      WHERE l.customer_id = $1
      ORDER BY l.created_at DESC
      `,
      [customerId]
    );

    res.json({ logs: result.rows });
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
}

async function addCustomerLog(req, res) {
  const { id: customerId } = req.params;
  const { type, note } = req.body;
  const userId = req.user.id;

  try {
    await pool.query(`
      INSERT INTO customer_logs (customer_id, user_id, type, note)
      VALUES ($1, $2, $3, $4)
    `, [customerId, userId, type, note]);

    await pool.query(`
      UPDATE customers SET last_contacted_at = NOW() WHERE id = $1
    `, [customerId]);

    res.status(201).json({ message: 'Log added' });
  } catch (err) {
    console.error('Log error:', err);
    res.status(500).json({ error: 'Could not save log' });
  }
}

async function getCRMLogs(req, res) {
  const { id: customerId } = req.params;
  const user = req.user;

  if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const result = await pool.query(`
      SELECT l.*, u.name AS user_name
      FROM crm_logs l
      JOIN users u ON l.user_id = u.id
      WHERE l.customer_id = $1
      ORDER BY l.created_at DESC
    `, [customerId]);

    res.json({ logs: result.rows });
  } catch (err) {
    console.error('Error fetching system logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
}

async function getCustomerInteractionLogs(req, res) {
  const customerId = req.params.id;
  const user = req.user;

  try {
    const result = await pool.query(
      `SELECT ARRAY_AGG(user_id) AS assigned
       FROM customer_assignments
       WHERE customer_id = $1`,
      [customerId]
    );

    const assigned = result.rows[0]?.assigned || [];
    const isAssigned = assigned.includes(user.id);

    if (user.role !== 'super_admin' && !isAssigned) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const logsRes = await pool.query(
      `SELECT l.*, u.name AS user_name
       FROM customer_logs l
       JOIN users u ON l.user_id = u.id
       WHERE l.customer_id = $1
       ORDER BY l.created_at DESC`,
      [customerId]
    );

    res.json({ logs: logsRes.rows });
  } catch (err) {
    console.error('Error fetching customer logs:', err);
    res.status(500).json({ error: 'Failed to fetch customer logs' });
  }
}

async function getCustomerById(req, res) {
  const customerId = req.params.id;
  const user = req.user;

  try {
    // Fetch the customer and their assigned users
    const result = await pool.query(
      `SELECT c.*,
              ARRAY_AGG(a.user_id) AS assigned_user_ids,
              ARRAY_AGG(u.name) AS assigned_user_names
       FROM customers c
       LEFT JOIN customer_assignments a ON c.id = a.customer_id
       LEFT JOIN users u ON a.user_id = u.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = result.rows[0];

    // 🔐 Access control: only assigned reps or super admins can view
    const isAssigned =
      customer.assigned_user_ids &&
      customer.assigned_user_ids.includes(user.id);

    if (user.role !== 'super_admin' && !isAssigned) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ customer });
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ error: 'Failed to retrieve customer' });
  }
}

async function deleteCustomer(req, res) {
  const { id } = req.params;
  const user = req.user;

  if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    await pool.query('BEGIN');

    await pool.query(`DELETE FROM customer_tasks WHERE customer_id = $1`, [id]);
    await pool.query(`DELETE FROM customer_logs WHERE customer_id = $1`, [id]);
    await pool.query(`DELETE FROM customer_assignments WHERE customer_id = $1`, [id]);
    await pool.query(`DELETE FROM sales_pipeline WHERE customer_id = $1`, [id]);
    await pool.query(`DELETE FROM crm_logs WHERE customer_id = $1`, [id]);
    await pool.query(`DELETE FROM customers WHERE id = $1`, [id]);

    await pool.query('COMMIT');
    res.json({ message: 'Customer and all related data deleted' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Delete customer failed:', err);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
}

module.exports = {
  getCustomers,
  searchCustomers,
  createCustomer,
  updateCustomer,
  assignCustomer,
  unassignCustomer,
  getCRMLogs,
  addCustomerLog,
  getCustomerInteractionLogs,
  getCustomerById,
  deleteCustomer,
};
