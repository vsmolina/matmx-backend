const pool = require('../db');

async function getUsers(req, res) {
    try {
        const result = await pool.query(`
        SELECT id, name, email, role FROM users ORDER BY name ASC
        `)
        res.json({ users: result.rows })
    } catch (err) {
        console.error('Error fetching users:', err)
        res.status(500).json({ error: 'Failed to fetch users' })
    }
}

async function getRole(req, res) {
    const { role } = req.query
    try {
        const result = role
        ? await pool.query('SELECT id, name FROM users WHERE role = $1 ORDER BY name', [role])
        : await pool.query('SELECT id, name FROM users ORDER BY name')
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ error: 'Failed to load users' })
    }
}

module.exports = {
    getUsers,
    getRole,
}