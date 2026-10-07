// Background intelligence agents: translation, event synthesis, and evidence-governed multi-agent publishing.
const aiClient=require('./aiClient');
const crypto=require('crypto');
const {translateItems}=require('./intelligenceTranslation');
const {runPublicationEditorialBoard,AGENT_ROLES}=require('./intelligencePublicationEditorialBoard');
const {query,globalQuery}=require('../config/database');
const {withOrg}=require('./orgScopedDb');
const {runWithOrgContext}=require('./tenantContext');
const logger=require('./logger');
const { buildEvidencePublication } = require('./intelligencePublicationBuilder');
const { researchPublicationIncidents } = require('./intelligenceIncidentResearch');
const { auditPublicationContent, assessPublicationQuality, isAggregatorDomain, normalizeDomain, sourceIsSubstantive, isRepetitiveTemplateText } = require('./publicationQuality');