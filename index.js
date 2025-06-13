require('dotenv').config()

const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 4000
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret'

const pool = require('./db') // now pulled from db/index.js
const inventoryRoutes = require('./routes/inventory') // IMS routes
const crmRoutes = require('./routes/crm'); // CRM routes
const crmTaskRoutes = require('./routes/crmTasks') // CRM Tasks routes
const userRoutes = require('./routes/users') // User routes
const pipelineRoutes = require('./routes/pipeline') // Pipeline routes
const salesRoutes = require('./routes/sales') // Sales routes

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// IMS MODULE ROUTES
app.use('/api/inventory', inventoryRoutes);

// CRM MODULE ROUTES
app.use('/api/crm', crmRoutes);

// CRM TASKS MODULE ROUTES
app.use('/api/crm/tasks', crmTaskRoutes);

// USER ROUTES
app.use('/api/users', userRoutes);

// PIPELINE ROUTES
app.use('/api/crm', pipelineRoutes);

// SALES ROUTES
app.use('/api/sales', salesRoutes);

// AUTHENTICATION ROUTES

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.active === false) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ message: 'Login successful' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token')
  res.json({ message: 'Logged out' })
})

app.get('/api/me', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    const result = await pool.query(
      'SELECT id AS "userId", name, email, role FROM users WHERE id = $1',
      [decoded.userId]
    )
    const user = result.rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    res.json({ user })
  } catch (err) {
    console.error('/api/me error:', err)
    res.status(403).json({ error: 'Invalid token' })
  }
})

// SUPER ADMIN USER MANAGEMENT

app.get('/api/admin/users', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden — super admin access only' })
    }

    const result = await pool.query('SELECT id, name, email, role, active, last_login FROM users ORDER BY id')
    res.json({ users: result.rows })
  } catch (err) {
    console.error('Error in /api/admin/users:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/admin/users', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })

    const { name, email, password, role } = req.body
    const hash = await bcrypt.hash(password, 10)

    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [name, email, hash, role]
    )

    res.json({ message: 'User created' })
  } catch (err) {
    console.error('Create user error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/admin/users/:id', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })

    const { id } = req.params
    await pool.query('DELETE FROM users WHERE id = $1', [id])
    res.json({ message: 'User deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/admin/users/:id/password', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })

    const { id } = req.params
    const { password } = req.body
    const hash = await bcrypt.hash(password, 10)

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id])
    res.json({ message: 'Password updated' })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/admin/users/:id', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })

    const { id } = req.params
    const { name, email, role } = req.body

    await pool.query(
      'UPDATE users SET name = $1, email = $2, role = $3 WHERE id = $4',
      [name, email, role, id]
    )

    res.json({ message: 'User updated' })
  } catch (err) {
    console.error('Update user error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/admin/users/:id/deactivate', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })

    const { id } = req.params
    await pool.query('UPDATE users SET active = false WHERE id = $1', [id])
    res.json({ message: 'User deactivated' })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.patch('/api/admin/users/:id/activate', async (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })

    const { id } = req.params
    await pool.query('UPDATE users SET active = true WHERE id = $1', [id])
    res.json({ message: 'User activated' })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// SERVER START
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
