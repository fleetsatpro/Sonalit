describe('email routing',()=>{
  beforeEach(()=>{delete process.env.RESEND_OPERATIONAL_FROM_EMAIL;delete process.env.RESEND_SECURITY_FROM_EMAIL;});
  test('routes operational alerts to notifications sender',()=>{const{resolveEmailRoute}=require('../src/services/email/routing');const r=resolveEmailRoute({type:'overspeed',severity:'high'});expect(r.audience).toBe('operational');expect(r.sender).toContain('notifications@sonalit.com');});
  test('routes security events to security sender',()=>{const{resolveEmailRoute}=require('../src/services/email/routing');const r=resolveEmailRoute({type:'e-lock-tamper',severity:'critical'});expect(r.audience).toBe('security');expect(r.sender).toContain('security@sonalit.com');});
  test('explicit security flag wins',()=>{const{isSecurityEvent}=require('../src/services/email/routing');expect(isSecurityEvent({type:'operational_alert',securityEvent:true})).toBe(true);});
});

describe('Client Pulse active-row rules',()=>{
  test('excludes delivered containers',()=>{const{isActiveRow}=require('../src/services/email/clientPulse.service');expect(isActiveRow({booking_status:'active',status:'delivered'})).toBe(false);});
  test('excludes completed bookings',()=>{const{isActiveRow}=require('../src/services/email/clientPulse.service');expect(isActiveRow({booking_status:'completed',status:'in_transit'})).toBe(false);});
  test('keeps an in-transit booking active',()=>{const{isActiveRow}=require('../src/services/email/clientPulse.service');expect(isActiveRow({booking_status:'active',status:'in_transit'})).toBe(true);});
});
