import { Router, type IRouter } from "express";
import healthRouter from "./health";
import contactRouter from "./contact";
import subscribeRouter from "./subscribe";
import adminRouter from "./admin";
import crmRouter from "./crm/index";
import toolsRouter from "./tools";
import stripeRouter from "./stripe";
import scraperRouter from "./scraper";
import scraperEngineRouter from "./scraperEngine";
import twilioRouter from "./twilio";
import twilioVoiceRouter from "./twilio-voice";
import { agentRouter } from "./twilio-voice-agent";
import powerDialerRouter from "./twilio-power-dialer";
import openPhoneRouter from "./openphone";
import demoRouter from "./demo";
import sseRouter from "./sse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(contactRouter);
router.use(subscribeRouter);
router.use(adminRouter);
router.use(crmRouter);
router.use(toolsRouter);
router.use(stripeRouter);
router.use(scraperRouter);
router.use(scraperEngineRouter);
router.use(twilioRouter);
router.use(twilioVoiceRouter);
router.use(agentRouter);
router.use(powerDialerRouter);
router.use(openPhoneRouter);
router.use(demoRouter);
router.use(sseRouter);

export default router;

