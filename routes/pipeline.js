const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const pipelineController = require('../controllers/pipelineController');

router.use(authenticateUser);

// GET /api/crm/:id/pipeline
router.get('/:id/pipeline', pipelineController.getPipelineHistory);

// POST /api/crm/:id/pipeline
router.post('/:id/pipeline', pipelineController.addPipelineStage);

module.exports = router;
