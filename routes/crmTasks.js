const express = require('express')
const router = express.Router()
const task = require('../controllers/crmTasksController')
const { authenticateUser } = require('../middleware/auth')

router.use(authenticateUser)

router.get('/', task.getTasks)
router.post('/', task.createTask)
router.post('/:id/complete', task.completeTask)
router.get('/grouped', task.getGroupedTasks)
router.get('/completed', task.getCompletedTasks)
router.post('/:id/undo', task.undoTaskCompletion)
router.get('/customer/:id/open', task.getCustomerOpenTasks)

module.exports = router
