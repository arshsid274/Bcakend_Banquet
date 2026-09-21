const mongoose = require('mongoose');

const InboundEnquirySchema = new mongoose.Schema({
  callerNumber: { type: String, required: true, trim: true },
  name: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  eventDate: { type: String, trim: true },
  guestCount: { type: Number, min: 1 },
  eventType: { type: String, trim: true },
  hallPreference: { type: String, trim: true },
  notes: { type: String, trim: true },
  callbackRequested: { type: Boolean, default: false },
  status: { type: String, enum: ['New', 'Reviewed'], default: 'New' },
  crmBookingId: { type: String, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('InboundEnquiry', InboundEnquirySchema);
