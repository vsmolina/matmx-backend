const express = require('express')
const router = express.Router()
const { verifyToken } = require('../lib/auth')

router.get('/', (req, res) => {
  const token = req.cookies.token

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  try {
    const user = verifyToken(token)
    res.status(200).json({ user })
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' })
  }
})

module.exports = router
