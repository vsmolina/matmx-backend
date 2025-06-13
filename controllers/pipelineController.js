const pool = require('../db');

// GET pipeline history for a customer
async function getPipelineHistory(req, res) {
  const { id: customerId } = req.params;
  const user = req.user;

  try {
    const result = await pool.query(`
      SELECT sp.*, u.name AS moved_by_name
      FROM sales_pipeline sp
      JOIN users u ON sp.moved_by = u.id
      WHERE sp.customer_id = $1
      ORDER BY sp.created_at DESC
    `, [customerId]);

    res.json({ pipeline: result.rows });
  } catch (err) {
    console.error('Error fetching pipeline:', err);
    res.status(500).json({ error: 'Could not fetch pipeline history' });
  }
}

// POST new pipeline stage
async function addPipelineStage(req, res) {
  const { id: customerId } = req.params;
  const { stage, comment } = req.body;
  const userId = req.user.id;

  if (!stage) return res.status(400).json({ error: 'Stage is required' });

  try {
    await pool.query(`
      INSERT INTO sales_pipeline (customer_id, stage, moved_by, comment)
      VALUES ($1, $2, $3, $4)
    `, [customerId, stage, userId, comment || null]);

    res.status(201).json({ message: 'Stage added' });
  } catch (err) {
    console.error('Error adding stage:', err);
    res.status(500).json({ error: 'Could not add stage' });
  }
}

module.exports = {
  getPipelineHistory,
  addPipelineStage
};
