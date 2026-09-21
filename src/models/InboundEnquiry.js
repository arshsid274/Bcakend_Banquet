const mongoose = require('mongoose');

const InboundEnquirySchema = new mongoose.Schema({
  callerNumber: { type: String, required: true, trim: true },
  whatsappNumber: { type: String, trim: true },
  name: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  eventDate: { type: String, trim: true },
  eventTime: { type: String, trim: true },
  guestCount: { type: Number, min: 1 },
  eventType: { type: String, trim: true },
  hallPreference: { type: String, trim: true },
  // The CRM booking form marks these required; the agent asks for them, but a
  // caller who is still undecided must not block the enquiry from being saved.
  ratePlan: { type: String, trim: true, enum: ['Silver', 'Gold', 'Platinum', null] },
  foodType: { type: String, trim: true, enum: ['Veg', 'Non-Veg'], default: 'Veg' },
  roomOption: { type: String, trim: true, enum: ['complimentary', 'additional', 'both', null] },
  complimentaryRooms: { type: Number, min: 0 },
  extraRooms: { type: Number, min: 0 },
  notes: { type: String, trim: true },
  callbackRequested: { type: Boolean, default: false },
  status: { type: String, enum: ['New', 'Reviewed'], default: 'New' },
  crmBookingId: { type: String, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('InboundEnquiry', InboundEnquirySchema);
