const pool = require('../db');

// Create a task
async function createTask(req, res) {
  const { customer_id, title, description, due_date, assigned_to } = req.body;
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `INSERT INTO customer_tasks (customer_id, assigned_to, created_by, title, description, due_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [customer_id, assigned_to, user_id, title, description, due_date]
    );
    res.status(201).json({ task: result.rows[0] });
  } catch (err) {
    console.error('Create task failed:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
}

// Get tasks by user (or super admin = all), incomplete only
async function getTasks(req, res) {
  const user = req.user;

  try {
    const result = await pool.query(
      user.role === 'super_admin'
        ? `
          SELECT t.*, c.name AS customer_name
          FROM customer_tasks t
          JOIN customers c ON t.customer_id = c.id
          WHERE t.status != 'completed'
          ORDER BY due_date ASC
        `
        : `
          SELECT t.*, c.name AS customer_name
          FROM customer_tasks t
          JOIN customers c ON t.customer_id = c.id
          WHERE t.assigned_to = $1 AND t.status != 'completed'
          ORDER BY due_date ASC
        `,
      user.role === 'super_admin' ? [] : [user.id]
    );

    res.status(200).json({ tasks: result.rows });
  } catch (err) {
    console.error('Fetch tasks failed:', err);
    res.status(500).json({ error: 'Failed to load tasks' });
  }
}

async function getCustomerOpenTasks(req, res) {
  const user = req.user;
  const customerId = req.params.id;

  try {
    const result = await pool.query(
      `
      SELECT t.*, c.name AS customer_name
      FROM customer_tasks t
      JOIN customers c ON t.customer_id = c.id
      WHERE t.customer_id = $1 AND t.status = 'open'
      `,
      [customerId]
    )

    res.status(200).json({ tasks: result.rows })
  } catch (err) {
    console.error('Fetch customer open tasks failed:', err)
    res.status(500).json({ error: 'Failed to fetch open tasks' })
  }
}


// Mark task as completed
async function completeTask(req, res) {
  const taskId = req.params.id;

  try {
    await pool.query(
      `UPDATE customer_tasks SET status = 'completed' WHERE id = $1`,
      [taskId]
    );
    res.json({ message: 'Task completed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
}

// Get all tasks grouped by rep, then by customer
async function getGroupedTasks(req, res) {
  const user = req.user;

  try {
    let result;

    if (user.role === 'super_admin') {
      result = await pool.query(`
        SELECT 
          t.*, 
          c.name AS customer_name,
          au.name AS assigned_to_name,
          cu.name AS created_by_name
        FROM customer_tasks t
        JOIN customers c ON t.customer_id = c.id
        JOIN users au ON t.assigned_to = au.id
        JOIN users cu ON t.created_by = cu.id
        WHERE t.status != 'completed'
        ORDER BY au.name, c.name, t.due_date ASC
      `);
    } else {
      result = await pool.query(`
        SELECT 
          t.*, 
          c.name AS customer_name,
          au.name AS assigned_to_name,
          cu.name AS created_by_name
        FROM customer_tasks t
        JOIN customers c ON t.customer_id = c.id
        JOIN users au ON t.assigned_to = au.id
        JOIN users cu ON t.created_by = cu.id
        WHERE t.status != 'completed' AND (
          t.assigned_to = $1
          OR t.customer_id IN (
            SELECT customer_id FROM customer_assignments WHERE user_id = $1
          )
        )
        ORDER BY au.name, c.name, t.due_date ASC
      `, [user.id]);
    }

    // Format into nested structure: rep -> customer -> tasks
    const grouped = {};

    for (const row of result.rows) {
      const repId = row.assigned_to;
      const customerId = row.customer_id;

      if (!grouped[repId]) {
        grouped[repId] = {
          rep_id: repId,
          rep_name: row.assigned_to_name,
          customers: {}
        };
      }

      if (!grouped[repId].customers[customerId]) {
        grouped[repId].customers[customerId] = {
          customer_id: customerId,
          customer_name: row.customer_name,
          tasks: []
        };
      }

      grouped[repId].customers[customerId].tasks.push(row);
    }

    const response = Object.values(grouped).map(rep => ({
      ...rep,
      customers: Object.values(rep.customers)
    }));

    res.status(200).json({ groupedTasks: response });
  } catch (err) {
    console.error("Grouped task fetch failed:", err);
    res.status(500).json({ error: "Failed to load grouped tasks" });
  }
}

// Get completed tasks (last 3 months), grouped by rep, optional customer filter
async function getCompletedTasks(req, res) {
  const customerId = req.query.customerId;
  const user = req.user;

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  try {
    const values = [threeMonthsAgo];
    let filterClause = `t.status = 'completed' AND t.created_at >= $1`;

    if (customerId) {
      values.push(customerId);
      filterClause += ` AND t.customer_id = $${values.length}`;
    }

    if (user.role !== 'super_admin') {
      values.push(user.id);
      filterClause += ` AND (t.assigned_to = $${values.length} OR t.created_by = $${values.length})`;
    }

    const query = `
      SELECT 
        t.*, 
        c.name AS customer_name,
        au.name AS assigned_to_name,
        cu.name AS created_by_name
      FROM customer_tasks t
      JOIN customers c ON t.customer_id = c.id
      JOIN users au ON t.assigned_to = au.id
      JOIN users cu ON t.created_by = cu.id
      WHERE ${filterClause}
      ORDER BY au.name, t.due_date DESC
    `;

    const result = await pool.query(query, values);

    // Group by assigned rep name
    const grouped = {};
    for (const row of result.rows) {
      const rep = row.assigned_to_name || 'Unassigned';
      if (!grouped[rep]) grouped[rep] = [];
      grouped[rep].push(row);
    }

    const response = Object.entries(grouped).map(([rep_name, tasks]) => ({
      rep_name,
      tasks
    }));

    res.json({ grouped: response });
  } catch (err) {
    console.error("Completed tasks fetch failed:", err);
    res.status(500).json({ error: "Failed to load completed tasks" });
  }
}

async function undoTaskCompletion(req, res) {
  const taskId = req.params.id

  try {
    await pool.query(
      `UPDATE customer_tasks SET status = 'open' WHERE id = $1`,
      [taskId]
    )
    res.json({ message: 'Task re-opened' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to undo task completion' })
  }
}

module.exports = {
  createTask,
  getTasks,
  completeTask,
  getGroupedTasks,
  getCompletedTasks,
  undoTaskCompletion,
  getCustomerOpenTasks,
};
