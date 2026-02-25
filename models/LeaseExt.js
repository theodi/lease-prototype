import mongoose from 'mongoose';

const leaseExtSchema = new mongoose.Schema({
  lease_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lease', index: true },
  start_date: Date,
  expiry_date: Date,
  tenure_years: Number
}, {
  timestamps: true,
  collection: 'leasesext',
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

leaseExtSchema.virtual('Start Date').get(function () {
  if (!this.start_date) return null;
  const d = new Date(this.start_date);
  return d.toISOString().split('T')[0]; // Format as 'YYYY-MM-DD'
});
leaseExtSchema.virtual('Expiry Date').get(function () {
  if (!this.expiry_date) return null;
  const d = new Date(this.expiry_date);
  return d.toISOString().split('T')[0]; // Returns YYYY-MM-DD
});
leaseExtSchema.virtual('Tenure Years').get(function () {
  return this.tenure_years;
});

// Static method to remap keys using virtual aliases
leaseExtSchema.statics.remapLeases = function (leases) {
  const formatDate = (d) => {
    if (!d) return null;
    const date = new Date(d);
    return date.toISOString().split('T')[0];
  };

  const mapOne = lease => ({
    '_id': lease._id,
    'lease_id': lease.lease_id,
    'Start Date': formatDate(lease.start_date),
    'Expiry Date': formatDate(lease.expiry_date),
    'Tenure Years': lease.tenure_years
  });

  if (Array.isArray(leases)) return leases.map(mapOne);
  return mapOne(leases);
};

const LeaseExt = mongoose.model('LeaseExt', leaseExtSchema);

export default LeaseExt;
