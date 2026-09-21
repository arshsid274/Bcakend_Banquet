const mongoose = require('mongoose');

const InboundCallSchema = new mongoose.Schema({
  workflowRunId: { type: String, required: true, unique: true, trim: true },
  callerNumber: { type: String, trim: true },
  callOutcome: { type: String, trim: true },
  summary: { type: String, trim: true },
  gatheredContext: { type: mongoose.Schema.Types.Mixed, default: {} },
  transcriptUrl: { type: String, trim: true },
  recordingUrl: { type: String, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('InboundCall', InboundCallSchema);
