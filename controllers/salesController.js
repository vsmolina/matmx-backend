const pool = require('../db');
const { sendQuoteEmail } = require('../lib/mailer');
const { uploadFile } = require('../lib/fileUpload');

// ---------------- Quotes ----------------

async function getQuotes(req, res) {
  const { role, id: userId } = req.user

  try {
    const baseQuery = `
      SELECT
        q.id,
        q.title,
        q.valid_until,
        q.delivery_date,
        q.status,
        q.currency,
        q.internal_note,
        q.customer_note,
        q.created_at,
        c.name AS customer_name,
        u.name AS rep_name,
        q.total
      FROM quotes q
      JOIN customers c ON q.customer_id = c.id
      JOIN users u ON q.rep_id = u.id
      ${role !== 'super_admin' ? 'WHERE q.rep_id = $1' : ''}
      ORDER BY q.created_at DESC
    `

    const result = await pool.query(
      baseQuery,
      role !== 'super_admin' ? [userId] : []
    )

    res.json(result.rows)
  } catch (err) {
    console.error('Error loading quotes:', err)
    res.status(500).json({ error: 'Failed to load quotes' })
  }
}

async function getQuoteById(req, res) {
  const { id } = req.params

  try {
    const quoteResult = await pool.query(
      `SELECT
        q.*,
        c.name AS customer_name,
        u.name AS rep_name
      FROM quotes q
      JOIN customers c ON q.customer_id = c.id
      JOIN users u ON q.rep_id = u.id
      WHERE q.id = $1`,
      [id]
    )

    const itemsResult = await pool.query(
      'SELECT * FROM quote_items WHERE quote_id = $1',
      [id]
    )

    res.json({
      ...quoteResult.rows[0],
      items: itemsResult.rows
    })
  } catch (err) {
    console.error('Error fetching quote by ID:', err)
    res.status(500).json({ error: 'Failed to fetch quote' })
  }
}


async function createQuote(req, res) {
  const { customer_id, title, valid_until, delivery_date, internal_note, customer_note, items, total } = req.body
  const rep_id = req.user.id

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Insert into quotes
    const quoteResult = await client.query(
      `INSERT INTO quotes (customer_id, rep_id, title, valid_until, delivery_date, internal_note, customer_note, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [customer_id, rep_id, title, valid_until, delivery_date, internal_note, customer_note, total]
    )

    const quoteId = quoteResult.rows[0].id

    // Insert items
    if (Array.isArray(items)) {
      for (const item of items) {
        const { product_id, quantity, unit_price, markup_percent = 0, discount_percent = 0, total_price } = item

        await client.query(
          `INSERT INTO quote_items (quote_id, product_id, quantity, unit_price, markup_percent, discount_percent, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [quoteId, product_id, quantity, unit_price, markup_percent, discount_percent, total_price]
        )
      }
    }

    await client.query('COMMIT')
    res.status(201).json({ quote_id: quoteId })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Failed to create quote:', err)
    res.status(500).json({ error: 'Failed to create quote' })
  } finally {
    client.release()
  }
}


async function updateQuote(req, res) {
  const { id } = req.params;
  const {
    title,
    valid_until,
    delivery_date,
    internal_note,
    customer_note,
    currency,
    total,
    items
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update quote metadata
    await client.query(
      `UPDATE quotes
       SET title = $1,
           valid_until = $2,
           delivery_date = $3,
           internal_note = $4,
           customer_note = $5,
           currency = $6,
           total = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [title, valid_until, delivery_date, internal_note, customer_note, currency, total, id]
    );

    // Clear existing items
    await client.query(`DELETE FROM quote_items WHERE quote_id = $1`, [id]);

    // Insert new items
    if (Array.isArray(items)) {
      for (const item of items) {
        const {
          product_id,
          quantity,
          unit_price,
          markup_percent = 0,
          discount_percent = 0,
          total_price
        } = item;

        await client.query(
          `INSERT INTO quote_items
           (quote_id, product_id, quantity, unit_price, markup_percent, discount_percent, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, product_id, quantity, unit_price, markup_percent, discount_percent, total_price]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to update quote:', err);
    res.status(500).json({ error: 'Failed to update quote' });
  } finally {
    client.release();
  }
}



async function convertQuoteToOrder(req, res) {
  const { id } = req.params;

  try {
    const quote = await pool.query('SELECT * FROM quotes WHERE id = $1', [id]);
    const items = await pool.query('SELECT * FROM quote_items WHERE quote_id = $1', [id]);

    const {
      customer_id,
      rep_id,
      currency
    } = quote.rows[0];

    const totals = items.rows.reduce((acc, item) => acc + Number(item.total_price), 0);

    const orderResult = await pool.query(
      `INSERT INTO orders (quote_id, customer_id, rep_id, subtotal, total, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id, customer_id, rep_id, totals, totals, currency]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items.rows) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, discount_percent, total_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.product_id, item.quantity, item.unit_price, item.discount_percent, item.total_price]
      );
    }

    res.status(201).json({ order_id: orderId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to convert quote to order' });
  }
}

async function emailQuote(req, res) {
  const { id } = req.params;
  try {
    const quote = await pool.query('SELECT * FROM quotes WHERE id = $1', [id]);
    const items = await pool.query('SELECT * FROM quote_items WHERE quote_id = $1', [id]);

    await sendQuoteEmail(quote.rows[0], items.rows);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send quote email' });
  }
}

async function uploadQuoteAttachment(req, res) {
  try {
    const { related_id } = req.body;
    const file = req.file;

    const result = await uploadFile(file); // assumes this returns a URL

    await pool.query(
      `INSERT INTO sales_attachments (related_type, related_id, filename, file_url, uploaded_by)
       VALUES ('quote', $1, $2, $3, $4)`,
      [related_id, file.originalname, result.url, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload quote attachment' });
  }
}

// ---------------- Orders ----------------

async function getOrders(req, res) {
  const { role, id: userId } = req.user;

  try {
    const query = role === 'super_admin'
      ? 'SELECT * FROM orders ORDER BY created_at DESC'
      : 'SELECT * FROM orders WHERE rep_id = $1 ORDER BY created_at DESC';

    const result = await pool.query(query, role === 'super_admin' ? [] : [userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load orders' });
  }
}

async function getOrderById(req, res) {
  const { id } = req.params;

  try {
    const order = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]);

    res.json({ ...order.rows[0], items: items.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
}

async function updateOrder(req, res) {
  const { id } = req.params;
  const { status, shipping_method, shipping_cost, fulfillment_date } = req.body;

  try {
    await pool.query(
      `UPDATE orders SET status = $1, shipping_method = $2, shipping_cost = $3, fulfillment_date = $4, updated_at = NOW()
       WHERE id = $5`,
      [status, shipping_method, shipping_cost, fulfillment_date, id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order' });
  }
}

async function uploadOrderAttachment(req, res) {
  try {
    const { related_id } = req.body;
    const file = req.file;

    const result = await uploadFile(file);

    await pool.query(
      `INSERT INTO sales_attachments (related_type, related_id, filename, file_url, uploaded_by)
       VALUES ('order', $1, $2, $3, $4)`,
      [related_id, file.originalname, result.url, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload order attachment' });
  }
}

// ---------------- Exports ----------------

module.exports = {
  getQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  convertQuoteToOrder,
  emailQuote,
  uploadQuoteAttachment,
  getOrders,
  getOrderById,
  updateOrder,
  uploadOrderAttachment
};
