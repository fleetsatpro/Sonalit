const router=require('express').Router();
// Resend/Svix signatures authenticate the provider webhook; it must not require an operator JWT.
router.use('/resend',require('./resendWebhook'));
const{authenticate}=require('../middleware/auth');
router.use(authenticate);
router.get('/',(req,res)=>res.json({data:[]}));
module.exports=router;
