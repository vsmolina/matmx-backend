const express = require('express')
const router = express.Router()
const { authenticateUser } = require('../middleware/auth')
const users = require('../controllers/usersController')

router.use(authenticateUser)

router.get('/', users.getUsers)
router.get('/roles', users.getRole)

module.exports = router
