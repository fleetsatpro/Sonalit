const mockEmailQueue={add:jest.fn().mockResolvedValue({})};
jest.mock('../src/config/queue',()=>({getQueues:()=>({emailQueue:mockEmailQueue})}));
jest.mock('../src/utils/orgScopedDb',()=>({withOrg:async(_org,fn)=>fn({query:jest.fn().mockResolvedValue({rows:[{id:'00000000-0000-0000-0000-000000000001'}]})})}));
jest.mock('../src/services/email/templates',()=>({
  alertTemplate:()=>({subject:'alert',text:'alert',html:'alert'}),
  securityAlertTemplate:()=>({subject:'security',text:'security',html:'security'}),
  clientPulseTemplate:({activeBookingCount})=>({subject:'CDS Client Pulse',text:String(activeBookingCount),html:'<p>pulse</p>'}),
  genericTemplate:()=>({subject:'generic',text:'generic',html:'generic'})
}));
jest.mock('../src/services/email/routing',()=>({resolveEmailRoute:()=>({sender:'Sonalit <notifications@sonalit.com>',replyTo:undefined,audience:'operations'})}));
process.env.RESEND_API_KEY='test-key';

const { queueClientPulseEmail } = require('../src/services/email/email.service');

describe('Client Pulse heartbeat enqueue',()=>{
  beforeEach(()=>mockEmailQueue.add.mockClear());

  test('queues a pulse even when there are zero active bookings',async()=>{
    const result=await queueClientPulseEmail({
      orgId:'00000000-0000-0000-0000-000000000001',
      recipients:['client@example.com'],
      snapshotAt:'2026-10-02T09:00:00.000Z',
      activeBookingCount:0,
      dateLabel:'02 Oct 2026',
      attachment:{filename:'pulse.xlsx',content:'YWJj',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
      correlationId:'cds-client-pulse:test',
      idempotencyKey:'cds-client-pulse:test'
    });
    expect(result.queued).toBe(1);
    expect(mockEmailQueue.add).toHaveBeenCalledWith('email.send',{emailNotificationId:'00000000-0000-0000-0000-000000000001'},expect.any(Object));
  });
});
