const express = require('express');
const controller = require('../controllers/DograhInboundController');

const router = express.Router();
router.post('/dograh/inbound/context', controller.requiresDograhKey, controller.preCallContext);
router.post('/dograh/inbound/enquiries', controller.requiresDograhKey, controller.createEnquiry);
router.post('/dograh/inbound/call-results', controller.requiresDograhKey, controller.saveCallResult);
router.get('/dograh/inbound/enquiries', controller.requiresDograhKey, controller.listEnquiries);
router.get('/dograh/inbound/calls', controller.requiresDograhKey, controller.listCalls);

module.exports = router;
