'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { withOrg } = require('../../src/utils/orgScopedDb');
const travelWorkspaceRouter = require('../../src/routes/sjmTravelWorkspace');

const ORG_A = 'aaaaaaaa-1111-4111-8111-000000000001';
const ORG_B = 'bbbbbbbb-1111-4111-8112-000000000001';

const USER_MANAGER_A = 'a1000000-0000-4000-8000-000000000001';
const USER_DRIVER_A = 'a1000000-0000-4000-8000-000000000002';
const USER_DRIVER_B = 'b1000000-0000-4000-8000-000000000001';

const JOURNEY_A = 'a2000000-0000-4000-8000-000000000001';
const JOURNEY_B = 'b2000000-0000-4000-8000-000000000001';
const PARTICIPANT_A = 'a3000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = 'b3000000-0000-4000-8000-000000000001';
const TRAVELLER_A = 'a4000000-0000-4000-8000-000000000001';
const TRAVELLER_B = 'b4000000-0000-4000-8000-000000000001';
const FLIGHT_A = 'a5000000-0000-4000-8000-000000000001';
const FLIGHT_B = 'b5000000-0000-4000-8000-000000000001';
const DAY_A = 'a6000000-0000-4000-8000-000000000001';
const DAY_B = 'b6000000-0000-4000-8000-000000000001';
const ITEM_A = 'a7000000-0000-4000-8000-000000000001';
const ITEM_B = 'b7000000-0000-4000-8000-000000000001';
const ITEM_EVENT_A = 'a8000000-0000-4000-8000-000000000001';
const ITEM_EVENT_B = 'b8000000-0000-4000-8000-000000000001';
const EVIDENCE_A = 'a9000000-0000-4000-8000-000000000001';
const EVIDENCE_B = 'b9000000-0000-4000-8000-000000000001';
const EVIDENCE_EVENT_A = 'aa000000-0000-4000-8000-000000000001';
const EVIDENCE_EVENT_B = 'bb000000-0000-4000-8000-000000000001';
const DOCUMENT_A = 'ac000000-0000-4000-8000-000000000001';
const DOCUMENT_B = 'bc000000-0000-4000-8000-000000000001';
const WORKSPACE_EVENT_A = 'ad000000-0000-4000-8000-000000000001';
const WORKSPACE_EVENT_B = 'bd000000-0000-4000-8000-000000000001';

let pool;

function authenticatedTestApp(user) {
  const app = express();
  app.use(express.json());
  app.use('/journeys/:id/travel-workspace', (req, _res, next) => {
    req.user = user;
    req.dbTx = fn => withOrg(user.org_id, fn);
    next();
  }, travelWorkspaceRouter);
  return app;
}

async function seedJourney({ orgId, journeyId, suffix, managerId, driverId, participantId,
  travellerId, flightId, dayId, itemId, itemEventId, evidenceId, evidenceEventId,
  documentId, workspaceEventId }) {
  await pool.query(
    `INSERT INTO sjm_journeys
      (id,org_id,reference,title,purpose,origin_label,origin_lat,origin_lng,
       destination_label,destination_lat,destination_lng,
       planned_departure_at,planned_arrival_at,timezone,status)
     VALUES
      ($1,$2,$3,$4,$5,'Jomo Kenyatta International Airport',-1.3192,36.9278,
       'Paris Charles de Gaulle',49.0097,2.5479,
       '2026-11-02T06:00:00.000Z','2026-11-02T14:00:00.000Z',
       'Africa/Nairobi','requested'`,
    [journeyId,orgId,'SJM-RLS-'+suffix,'SJM tenant isolation '+suffix,'Synthetic isolated integration fixture'],
  );
  await pool.query(
    `INSERT INTO sjm_journey_participants (id,org_id,journey_id,user_id,duty_role,is_primary,assigned_by)
     VALUES ($1,$2,$3,$4,'driver',true,$5)`,
    [participantId,orgId,journeyId,driverId,managerId],
  );
  await pool.query(
    `INSERT INTO sjm_travellers
      (id,org_id,journey_id,traveller_reference,traveller_type,title,given_name,family_name,
       nationality,date_of_birth,email,phone,emergency_contact_name,emergency_contact_phone,
       internal_notes,created_by,updated_by)
     VALUES ($1,$2,$3,$4,'principal','Ms',$5,$6,'Kenyan','1994-04-18',
       $7,'+254700000000','Emergency Contact','+254711111111',
       'Confidential synthetic integration fixture',$8,$8)`,
    [travellerId,orgId,journeyId,'TRV-RLS-'+suffix,'Amina'+suffix,'Example',
      'amina.'+suffix.toLowerCase()+'@example.invalid',managerId],
  );
  await pool.query(
    `INSERT INTO sjm_flight_segments
      (id,org_id,journey_id,traveller_id,sequence,carrier,flight_number,
       departure_airport,departure_airport_name,departure_at,departure_timezone,
       arrival_airport,arrival_airport_name,arrival_at,arrival_timezone,
       booking_reference,status,status_source)
     VALUES ($1,$2,$3,$4,1,'Test Airways','TA 100','NBO',
       'Jomo Kenyatta International Airport','2026-11-02T06:00:00.000Z','Africa/Nairobi',
       'CDG','Paris Charles de Gaulle','2026-11-02T14:00:00.000Z','Europe/Paris',
       $5,'scheduled','operator_entered')`,
    [flightId,orgId,journeyId,travellerId,'BOOK-'+suffix],
  );
  await pool.query(
    `INSERT INTO sjm_itinerary_days (id,org_id,journey_id,journey_date,timezone,day_title,created_by,updated_by)
     VALUES ($1,$2,$3,'2026-11-02','Africa/Nairobi','Arrival and reception',$4,$4)`,
    [dayId,orgId,journeyId,managerId],
  );
  await pool.query(
    `INSERT INTO sjm_itinerary_items
      (id,org_id,journey_id,day_id,traveller_id,sequence,item_type,title,
       location_label,planned_start_at,planned_end_at,responsible_user_id,responsible_role,
       flight_segment_id,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,1,'meet_and_greet','Airport meet and greet',
       'NBO arrivals','2026-11-02T07:00:00.000Z','2026-11-02T08:00:00.000Z',
       $6,'driver',$7,$8,$8)`,
    [itemId,orgId,journeyId,dayId,travellerId,driverId,flightId,managerId],
  );
  await pool.query(
    `INSERT INTO sjm_itinerary_item_events
      (id,org_id,journey_id,day_id,item_id,actor_id,action,detail)
     VALUES ($1,$2,$3,$4,$5,$6,'PLAN_CREATED','{"fixture":"synthetic"}'::jsonb)`,
    [itemEventId,orgId,journeyId,dayId,itemId,managerId],
  );
  await pool.query(
    `INSERT INTO sjm_evidence
      (id,org_id,journey_id,category,file_name,mime_type,size_bytes,storage_key,status,
       access_classification,created_by)
     VALUES ($1,$2,$3,'document',$4,'application/pdf',128,
       $5,'UPLOAD_PENDING','HIGHLY_SENSITIVE',$6)`,
    [evidenceId,orgId,journeyId,'passport-'+suffix+'.pdf',
      'orgs/'+orgId+'/sjm/'+journeyId+'/integration/'+evidenceId+'.pdf',managerId],
  );
  await pool.query(
    `INSERT INTO sjm_evidence_events
      (id,org_id,journey_id,evidence_id,actor_id,action,detail)
     VALUES ($1,$2,$3,$4,$5,'UPLOAD_REQUESTED','{"fixture":"synthetic"}'::jsonb)`,
    [evidenceEventId,orgId,journeyId,evidenceId,managerId],
  );
  await pool.query(
    `INSERT INTO sjm_travel_documents
      (id,org_id,journey_id,traveller_id,evidence_id,document_type,holder_name,
       issuing_country,expiry_date,created_by)
     VALUES ($1,$2,$3,$4,$5,'passport',$6,'Kenya','2030-01-01',$7)`,
    [documentId,orgId,journeyId,travellerId,evidenceId,'Amina '+suffix,managerId],
  );
  await pool.query(
    `INSERT INTO sjm_travel_workspace_events
      (id,org_id,journey_id,actor_id,action,subject_id,detail)
     VALUES ($1,$2,$3,$4,'TRAVELLER_CREATED',$5,'{"fixture":"synthetic"}'::jsonb)`,
    [workspaceEventId,orgId,journeyId,managerId,travellerId],
  );
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  await pool.query('BEGIN');
  try {
    await pool.query(
      `INSERT INTO users (id,email,name,role,org_id,status,password_hash) VALUES
        ($1,'sjm-rls-manager-a@example.invalid','SJM RLS Manager A','admin',$2,'active','test-hash'),
        ($3,'sjm-rls-driver-a@example.invalid','SJM RLS Driver A','operator',$2,'active','test-hash'),
        ($4,'sjm-rls-driver-b@example.invalid','SJM RLS Driver B','operator',$5,'active','test-hash')
       ON CONFLICT (id) DO NOTHING`,
      [USER_MANAGER_A,ORG_A,USER_DRIVER_A,USER_DRIVER_B,ORG_B],
    );
    await seedJourney({
      orgId:ORG_A,journeyId:JOURNEY_A,suffix:'A',managerId:USER_MANAGER_A,driverId:USER_DRIVER_A,
      participantId:PARTICIPANT_A,travellerId:TRAVELLER_A,flightId:FLIGHT_A,dayId:DAY_A,itemId:ITEM_A,
      itemEventId:ITEM_EVENT_A,evidenceId:EVIDENCE_A,evidenceEventId:EVIDENCE_EVENT_A,
      documentId:DOCUMENT_A,workspaceEventId:WORKSPACE_EVENT_A,
    });
    await seedJourney({
      orgId:ORG_B,journeyId:JOURNEY_B,suffix:'B',managerId:USER_DRIVER_B,driverId:USER_DRIVER_B,
      participantId:PARTICIPANT_B,travellerId:TRAVELLER_B,flightId:FLIGHT_B,dayId:DAY_B,itemId:ITEM_B,
      itemEventId:ITEM_EVENT_B,evidenceId:EVIDENCE_B,evidenceEventId:EVIDENCE_EVENT_B,
      documentId:DOCUMENT_B,workspaceEventId:WORKSPACE_EVENT_B,
    });
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
});

afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM sjm_travel_workspace_events WHERE id = ANY($1::uuid[])', [[WORKSPACE_EVENT_A,WORKSPACE_EVENT_B]]);
    await pool.query('DELETE FROM sjm_itinerary_item_events WHERE id = ANY($1::uuid[])', [[ITEM_EVENT_A,ITEM_EVENT_B]]);
    await pool.query('DELETE FROM sjm_travel_documents WHERE id = ANY($1::uuid[])', [[DOCUMENT_A,DOCUMENT_B]]);
    await pool.query('DELETE FROM sjm_evidence_events WHERE id = ANY($1::uuid[])', [[EVIDENCE_EVENT_A,EVIDENCE_EVENT_B]]);
    await pool.query('DELETE FROM sjm_evidence WHERE id = ANY($1::uuid[])', [[EVIDENCE_A,EVIDENCE_B]]);
    await pool.query('DELETE FROM sjm_itinerary_items WHERE id = ANY($1::uuid[])', [[ITEM_A,ITEM_B]]);
    await pool.query('DELETE FROM sjm_flight_segments WHERE id = ANY($1::uuid[])', [[FLIGHT_A,FLIGHT_B]]);
    await pool.query('DELETE FROM sjm_itinerary_days WHERE id = ANY($1::uuid[])', [[DAY_A,DAY_B]]);
    await pool.query('DELETE FROM sjm_travellers WHERE id = ANY($1::uuid[])', [[TRAVELLER_A,TRAVELLER_B]]);
    await pool.query('DELETE FROM sjm_journey_participants WHERE id = ANY($1::uuid[])', [[PARTICIPANT_A,PARTICIPANT_B]]);
    await pool.query('DELETE FROM sjm_journeys WHERE id = ANY($1::uuid[])', [[JOURNEY_A,JOURNEY_B]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_MANAGER_A,USER_DRIVER_A,USER_DRIVER_B]]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }
});

const skip = () => !process.env.DATABASE_URL;

test('SJM tenant rows are isolated across participants, travellers, flights, programme, documents and evidence', async () => {
  if (skip()) return;
  const idsByTable = [
    ['sjm_journeys',[JOURNEY_A,JOURNEY_B]],
    ['sjm_journey_participants',[PARTICIPANT_A,PARTICIPANT_B]],
    ['sjm_travellers',[TRAVELLER_A,TRAVELLER_B]],
    ['sjm_flight_segments',[FLIGHT_A,FLIGHT_B]],
    ['sjm_itinerary_days',[DAY_A,DAY_B]],
    ['sjm_itinerary_items',[ITEM_A,ITEM_B]],
    ['sjm_itinerary_item_events',[ITEM_EVENT_A,ITEM_EVENT_B]],
    ['sjm_evidence',[EVIDENCE_A,EVIDENCE_B]],
    ['sjm_evidence_events',[EVIDENCE_EVENT_A,EVIDENCE_EVENT_B]],
    ['sjm_travel_documents',[DOCUMENT_A,DOCUMENT_B]],
    ['sjm_travel_workspace_events',[WORKSPACE_EVENT_A,WORKSPACE_EVENT_B]],
  ];
  for (const [table,ids] of idsByTable) {
    const visible = await withOrg(ORG_A,client => client.query(
      'SELECT id FROM public.'+table+' WHERE id = ANY($1::uuid[]) ORDER BY id', [ids],
    ));
    expect(visible.rows.map(row=>row.id)).toEqual([ids[0]]);
  }
  for (const [table,ids] of idsByTable) {
    const visible = await withOrg(ORG_B,client => client.query(
      'SELECT id FROM public.'+table+' WHERE id = ANY($1::uuid[]) ORDER BY id', [ids],
    ));
    expect(visible.rows.map(row=>row.id)).toEqual([ids[1]]);
  }
});

test('SJM RLS rejects cross-tenant writes and hides foreign updates and deletes', async () => {
  if (skip()) return;
  const update = await withOrg(ORG_A,client => client.query(
    'UPDATE public.sjm_travellers SET family_name=$1 WHERE id=$2', ['Tamper',TRAVELLER_B],
  ));
  expect(update.rowCount).toBe(0);
  const deleted = await withOrg(ORG_A,client => client.query(
    'DELETE FROM public.sjm_evidence WHERE id=$1', [EVIDENCE_B],
  ));
  expect(deleted.rowCount).toBe(0);
  await expect(withOrg(ORG_A,client => client.query(
    'INSERT INTO public.sjm_travellers (org_id,journey_id,traveller_reference,traveller_type,given_name,family_name) VALUES ($1,$2,\\'TRV-FOREIGN-WRITE\\',\\'principal\\',\\'Foreign\\',\\'Write\\')',
    [ORG_B,JOURNEY_B],
  ))).rejects.toMatchObject({ code:'42501' });
});

test('field-duty API projection omits traveller PII, highly-sensitive documents and booking references', async () => {
  if (skip()) return;
  const app = authenticatedTestApp({
    id:USER_DRIVER_A,email:'sjm-rls-driver-a@example.invalid',name:'SJM RLS Driver A',
    role:'operator',status:'active',org_id:ORG_A,
  });
  const response = await request(app).get('/journeys/'+JOURNEY_A+'/travel-workspace').expect(200);
  expect(response.body.data.access.manager).toBe(false);
  expect(response.body.data.travellers).toHaveLength(1);
  const traveller = response.body.data.travellers[0];
  expect(traveller.display_name).toBe('Ms AminaA Example');
  for (const privateField of ['given_name','family_name','date_of_birth','email','phone',
    'emergency_contact_name','emergency_contact_phone','internal_notes']) {
    expect(traveller).not.toHaveProperty(privateField);
  }
  expect(response.body.data.documents).toEqual([]);
  expect(response.body.data.flights).toHaveLength(1);
  expect(response.body.data.flights[0].booking_reference).toBeNull();
  expect(response.body.data.flights[0].traveller_display_name).toBe('Ms AminaA Example');
});

test('mobility managers can read the full traveller dossier and document register', async () => {
  if (skip()) return;
  const app = authenticatedTestApp({
    id:USER_MANAGER_A,email:'sjm-rls-manager-a@example.invalid',name:'SJM RLS Manager A',
    role:'admin',status:'active',org_id:ORG_A,
  });
  const response = await request(app).get('/journeys/'+JOURNEY_A+'/travel-workspace').expect(200);
  expect(response.body.data.access.manager).toBe(true);
  expect(response.body.data.travellers).toHaveLength(1);
  expect(response.body.data.travellers[0]).toMatchObject({
    email:'amina.a@example.invalid',
    phone:'+254700000000',
    emergency_contact_name:'Emergency Contact',
    internal_notes:'Confidential synthetic integration fixture',
  });
  expect(response.body.data.documents).toHaveLength(1);
  expect(response.body.data.documents[0]).toMatchObject({
    document_type:'passport',
    holder_name:'Amina A',
    file_name:'passport-A.pdf',
    mime_type:'application/pdf',
  });
  expect(response.body.data.flights[0].booking_reference).toBe('BOOK-A');
});
