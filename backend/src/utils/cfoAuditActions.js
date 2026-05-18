/**
 * Canonical guardian_audit_log action strings for the CFO module.
 * All CFO-related audit entries use one of these constants to prevent
 * typo drift across controllers and workers.
 */
const CFO_AUDIT = {
  // Convoy lifecycle
  CONVOY_CREATED:              'convoy_created',
  CONVOY_ACTIVATED:            'convoy_activated',
  CONVOY_COMPLETED:            'convoy_completed',
  CONVOY_CANCELLED:            'convoy_cancelled',

  // Truck management
  TRUCK_ADDED:                 'convoy_truck_added',
  TRUCK_REMOVED:               'convoy_truck_removed',

  // CFO user management
  CFO_ADDED:                   'convoy_cfo_added',
  CFO_REMOVED:                 'convoy_cfo_removed',

  // Assignment management
  ASSIGNMENT_ADDED:            'convoy_cfo_assignment_added',
  ASSIGNMENT_REMOVED:          'convoy_cfo_assignment_removed',

  // Photo operations
  PHOTO_COMMITTED:             'cfo_photo_committed',

  // Report operations
  REPORT_REGENERATED:          'convoy_report_regenerated',
  REPORT_GENERATED:            'convoy_report_generated',
  ARCHIVE_GENERATED:           'convoy_archive_generated',
};

module.exports = { CFO_AUDIT };
