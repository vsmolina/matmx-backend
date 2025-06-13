const pool = require('../db');
const { createObjectCsvStringifier } = require('csv-writer');
const fs = require('fs');
const csv = require('csv-parser');

async function getAllProducts(req, res) {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY name ASC');
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createProduct(req, res) {
  const { name, sku, vendor, stock, reorder_threshold, unit_price, category, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO products (name, sku, vendor, stock, reorder_threshold, unit_price, category, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, sku, vendor, stock || 0, reorder_threshold || 0, unit_price, category, notes]
    );
    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
}

async function updateProduct(req, res) {
  const productId = req.params.id;
  const { name, sku, vendor, stock, reorder_threshold, unit_price, category, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE products SET name = $1, sku = $2, vendor = $3, stock = $4, reorder_threshold = $5, unit_price = $6, category = $7, notes = $8, updated_at = CURRENT_TIMESTAMP WHERE id = $9 RETURNING *`,
      [name, sku, vendor, stock, reorder_threshold, unit_price, category, notes, productId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
}

async function adjustInventory(req, res) {
  const productId = req.params.id;
  const userId = req.user.id;

  // Parse and validate change
  const parsedChange = Number(req.body.change);
  const reason = req.body.reason?.trim() || 'unspecified';
  const note = req.body.note?.trim() || null;

  if (isNaN(parsedChange)) {
    return res.status(400).json({ error: 'Invalid change value' });
  }

  try {
    await pool.query('BEGIN');

    const productResult = await pool.query(
      'SELECT stock FROM products WHERE id = $1',
      [productId]
    );

    if (productResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    const currentStock = productResult.rows[0].stock;
    const newStock = currentStock + parsedChange;

    await pool.query(
      'UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newStock, productId]
    );

    await pool.query(
      `INSERT INTO inventory_adjustments (product_id, change, reason, note, adjusted_by, resulting_stock)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [productId, parsedChange, reason, note, userId, newStock]
    );

    await pool.query('COMMIT');
    res.json({ message: 'Inventory updated successfully', newStock });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error adjusting inventory:', err);
    res.status(500).json({ error: 'Failed to adjust inventory' });
  }
}


async function getProductHistory(req, res) {
  const productId = req.params.id;
  try {
    const result = await pool.query(
      `SELECT * FROM inventory_adjustment_history WHERE product_id = $1`,
      [productId]
    )

    res.json({ history: result.rows });
  } catch (err) {
    console.error('Error fetching adjustment history:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

async function getReorderAlerts(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, sku, stock, reorder_threshold FROM products WHERE stock < reorder_threshold ORDER BY name`
    );
    res.json({ alerts: result.rows });
  } catch (err) {
    console.error('Error fetching reorder alerts:', err);
    res.status(500).json({ error: 'Failed to fetch reorder alerts' });
  }
}

async function exportInventory(req, res) {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY name');
    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'id', title: 'ID' },
        { id: 'name', title: 'Name' },
        { id: 'sku', title: 'SKU' },
        { id: 'vendor', title: 'Vendor' },
        { id: 'stock', title: 'Stock' },
        { id: 'reorder_threshold', title: 'Reorder Threshold' },
        { id: 'unit_price', title: 'Unit Price' },
        { id: 'category', title: 'Category' },
        { id: 'notes', title: 'Notes' },
      ]
    });
    const csv = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(result.rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=inventory.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error exporting inventory:', err);
    res.status(500).json({ error: 'Failed to export inventory' });
  }
}

async function importInventory(req, res) {
  const file = req.file;
  const userId = req.user.id;
  const note = req.body.note || null;

  if (!file) {
    return res.status(400).json({ error: 'No CSV uploaded' });
  }

  const results = [];

  try {
    // Parse CSV and clean BOM headers
    await new Promise((resolve, reject) => {
      fs.createReadStream(file.path)
        .pipe(csv())
        .on('data', (row) => {
          const cleanedRow = {};
          for (const key in row) {
            const sanitizedKey = key.replace(/^\uFEFF/, '');
            cleanedRow[sanitizedKey] = row[key];
          }
          results.push(cleanedRow);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    let success = 0;
    let failed = 0;

    for (const row of results) {
      try {
        const {
          name,
          sku,
          vendor,
          stock,
          reorder_threshold,
          unit_price,
          category,
          notes,
        } = row;

        // Validation
        if (!sku || typeof sku !== 'string' || sku.trim() === '') {
          console.warn('Invalid row: missing sku', row);
          failed++;
          continue;
        }
        if (!name || typeof name !== 'string') {
          console.warn('Invalid row: missing name', row);
          failed++;
          continue;
        }

        const parsedStock = parseInt(stock);
        const parsedThreshold = parseInt(reorder_threshold);
        const parsedPrice = parseFloat(unit_price);

        if (isNaN(parsedStock)) {
          console.warn('Invalid row: stock not a number', row);
          failed++;
          continue;
        }

        if (unit_price && isNaN(parsedPrice)) {
          console.warn('Invalid row: unit_price not a number', row);
          failed++;
          continue;
        }

        await pool.query(
          `
          INSERT INTO products (name, sku, vendor, stock, reorder_threshold, unit_price, category, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (sku) DO UPDATE SET
            name = EXCLUDED.name,
            vendor = EXCLUDED.vendor,
            stock = EXCLUDED.stock,
            reorder_threshold = EXCLUDED.reorder_threshold,
            unit_price = EXCLUDED.unit_price,
            category = EXCLUDED.category,
            notes = EXCLUDED.notes
          `,
          [name, sku, vendor, parsedStock, parsedThreshold, parsedPrice, category, notes]
        );

        success++;
      } catch (err) {
        console.error(`Row failed:`, row, '\nReason:', err.message);
        failed++;
      }
    }

    // Log import audit
    await pool.query(
      `
      INSERT INTO inventory_imports (uploaded_by, filename, success_count, failure_count, note)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, file.originalname, success, failed, note]
    );

    // Delete uploaded file
    fs.unlink(file.path, (err) => {
      if (err) console.error('Failed to delete uploaded CSV:', err);
    });

    return res.json({ message: 'Import complete', success, failed });
  } catch (err) {
    console.error('Unexpected import error:', err);

    // Attempt to clean up even on failure
    fs.unlink(file.path, (unlinkErr) => {
      if (unlinkErr) console.error('Cleanup error:', unlinkErr);
    });

    return res.status(500).json({ error: 'Import failed due to server error' });
  }
}

async function getImportLogs(req, res) {
  const userId = req.user.id;
  const role = req.user.role;

  if (role !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { uploaded_by, start_date, end_date } = req.query;
  const values = [];
  const conditions = [];

  if (uploaded_by) {
    values.push(uploaded_by);
    conditions.push(`i.uploaded_by = $${values.length}`);
  }

  if (start_date) {
    values.push(start_date);
    conditions.push(`i.created_at >= $${values.length}`);
  }

  if (end_date) {
    values.push(end_date);
    conditions.push(`i.created_at <= $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `
      SELECT
        i.id,
        i.created_at AS timestamp,
        u.name AS user_name,
        i.filename,
        i.success_count,
        i.failure_count,
        i.note
      FROM inventory_imports i
      JOIN users u ON i.uploaded_by = u.id
      ${whereClause}
      ORDER BY i.created_at DESC
      `,
      values
    );

    res.json({ logs: result.rows });
  } catch (err) {
    console.error('Error fetching import logs:', err);
    res.status(500).json({ error: 'Failed to load import logs' });
  }
}

module.exports = {
  getAllProducts,
  createProduct,
  updateProduct,
  adjustInventory,
  getProductHistory,
  getReorderAlerts,
  exportInventory,
  importInventory,
  getImportLogs,
};
