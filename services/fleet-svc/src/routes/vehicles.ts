import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { vehicleOpsCounter } from '../lib/metrics.js';
import { AppError } from '../lib/errors.js';

const FuelType = z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'cng', 'lpg']);
const VehicleStatus = z.enum(['active', 'inactive', 'maintenance', 'retired']);

const CreateVehicleSchema = z.object({
  plate: z.string().min(1).max(20), make: z.string().min(1).max(100), model: z.string().min(1).max(100),
  year: z.number().int().min(1900).max(2100), vin: z.string().max(17).optional(), fuel_type: FuelType,
  status: VehicleStatus.default('active'), client_id: z.string().uuid().nullable().optional(),
});
const PatchVehicleSchema = CreateVehicleSchema.partial();
const ListQuerySchema = z.object({ page:z.coerce.number().int().min(1).default(1), limit:z.coerce.number().int().min(1).max(100).default(20), status:VehicleStatus.optional(), search:z.string().max(200).optional() });
interface VehicleRow { id:string; org_id:string; plate:string; make:string; model:string; year:number; vin:string|null; fuel_type:string; status:string; client_id:string|null; client_name?:string|null; client_company?:string|null; created_at:string; updated_at:string; deleted_at:string|null; }

async function validateClient(orgId:string, clientId:string|null|undefined) {
  if (clientId == null) return;
  const [client] = await query<{id:string}>(`SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1`, [clientId, orgId]);
  if (!client) throw new ValidationError('Client does not belong to this organization');
}

export const vehicleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.get('/v4/vehicles', async (request, reply) => {
    const parsed=ListQuerySchema.safeParse(request.query); if(!parsed.success) throw new ValidationError(parsed.error.issues.map(i=>i.message).join(', '));
    const {page,limit,status,search}=parsed.data; const offset=(page-1)*limit; const orgId=request.user!.org_id;
    const conditions:string[]=['v.org_id=$1','v.deleted_at IS NULL']; const values:unknown[]=[orgId]; let idx=2;
    if(status){conditions.push(`v.status=$${idx++}`);values.push(status);} if(search){conditions.push(`(v.plate ILIKE $${idx} OR v.make ILIKE $${idx} OR v.model ILIKE $${idx})`);values.push(`%${search}%`);idx++;}
    const where=conditions.join(' AND ');
    const rows=await query<VehicleRow>(`SELECT v.*,cc.name AS client_name,cc.company AS client_company FROM vehicles v LEFT JOIN cargo_clients cc ON cc.id=v.client_id AND cc.org_id=v.org_id AND cc.deleted_at IS NULL WHERE ${where} ORDER BY v.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,[...values,limit,offset]);
    const [countRow]=await query<{count:string}>(`SELECT COUNT(*) AS count FROM vehicles v WHERE ${where}`,values);
    vehicleOpsCounter.inc({operation:'list',result:'ok'}); await reply.send({data:rows,total:Number(countRow?.count??0),page,limit});
  });
  app.post('/v4/vehicles', async (request,reply)=>{const parsed=CreateVehicleSchema.safeParse(request.body);if(!parsed.success)throw new ValidationError(parsed.error.issues.map(i=>i.message).join(', '));const v=parsed.data;const orgId=request.user!.org_id;await validateClient(orgId,v.client_id);const [row]=await query<VehicleRow>(`INSERT INTO vehicles (org_id,plate,make,model,year,vin,fuel_type,status,client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[orgId,v.plate,v.make,v.model,v.year,v.vin??null,v.fuel_type,v.status,v.client_id??null]);if(!row)throw new AppError('INSERT_FAILED','Failed to create vehicle',500);vehicleOpsCounter.inc({operation:'create',result:'ok'});await reply.status(201).send(row);});
  app.get('/v4/vehicles/:id', async(request,reply)=>{const {id}=request.params as {id:string};const orgId=request.user!.org_id;const [row]=await query<VehicleRow>(`SELECT v.*,cc.name AS client_name,cc.company AS client_company FROM vehicles v LEFT JOIN cargo_clients cc ON cc.id=v.client_id AND cc.org_id=v.org_id AND cc.deleted_at IS NULL WHERE v.id=$1 AND v.org_id=$2 AND v.deleted_at IS NULL`,[id,orgId]);if(!row)throw new NotFoundError('Vehicle');vehicleOpsCounter.inc({operation:'get',result:'ok'});await reply.send(row);});
  app.patch('/v4/vehicles/:id', async(request,reply)=>{const {id}=request.params as {id:string};const orgId=request.user!.org_id;const parsed=PatchVehicleSchema.safeParse(request.body);if(!parsed.success)throw new ValidationError(parsed.error.issues.map(i=>i.message).join(', '));const updates=parsed.data;await validateClient(orgId,updates.client_id);const fields=Object.keys(updates) as Array<keyof typeof updates>;if(!fields.length)throw new ValidationError('No fields to update');const setClauses=fields.map((f,i)=>`${f}=$${i+3}`).join(', ');const values=fields.map(f=>updates[f]);const [row]=await query<VehicleRow>(`UPDATE vehicles SET ${setClauses},updated_at=NOW() WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL RETURNING *`,[id,orgId,...values]);if(!row)throw new NotFoundError('Vehicle');vehicleOpsCounter.inc({operation:'update',result:'ok'});await reply.send(row);});
  app.delete('/v4/vehicles/:id', async(request,reply)=>{const {id}=request.params as {id:string};const orgId=request.user!.org_id;const [row]=await query<{id:string}>(`UPDATE vehicles SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL RETURNING id`,[id,orgId]);if(!row)throw new NotFoundError('Vehicle');vehicleOpsCounter.inc({operation:'delete',result:'ok'});await reply.status(204).send();});
};
