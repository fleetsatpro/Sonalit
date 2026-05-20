locals {
  name_prefix = "sonalit-${var.environment}"
  azs         = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]

  private_subnet_cidrs = [
    cidrsubnet(var.vpc_cidr, 4, 0),
    cidrsubnet(var.vpc_cidr, 4, 1),
    cidrsubnet(var.vpc_cidr, 4, 2),
  ]
  public_subnet_cidrs = [
    cidrsubnet(var.vpc_cidr, 4, 8),
    cidrsubnet(var.vpc_cidr, 4, 9),
    cidrsubnet(var.vpc_cidr, 4, 10),
  ]
}

module "vpc" {
  source = "./modules/vpc"

  name_prefix          = local.name_prefix
  vpc_cidr             = var.vpc_cidr
  azs                  = local.azs
  private_subnet_cidrs = local.private_subnet_cidrs
  public_subnet_cidrs  = local.public_subnet_cidrs
  environment          = var.environment
  tags                 = var.tags
}

module "eks" {
  source = "./modules/eks"

  cluster_name        = var.eks_cluster_name
  kubernetes_version  = var.eks_version
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  environment         = var.environment
  tags                = var.tags

  depends_on = [module.vpc]
}

module "rds" {
  source = "./modules/rds"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  eks_node_sg_id     = module.eks.node_security_group_id
  instance_class     = var.rds_instance_class
  allocated_storage  = var.rds_allocated_storage
  environment        = var.environment
  tags               = var.tags

  depends_on = [module.vpc, module.eks]
}

module "redis" {
  source = "./modules/redis"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  eks_node_sg_id     = module.eks.node_security_group_id
  node_type          = var.redis_node_type
  environment        = var.environment
  tags               = var.tags

  depends_on = [module.vpc, module.eks]
}

module "nats" {
  source = "./modules/nats"

  namespace        = "sonalit-infra"
  eks_cluster_name = module.eks.cluster_name
  environment      = var.environment
  tags             = var.tags

  depends_on = [module.eks]
}

module "clickhouse" {
  source = "./modules/clickhouse"

  namespace        = "sonalit-infra"
  eks_cluster_name = module.eks.cluster_name
  environment      = var.environment
  tags             = var.tags

  depends_on = [module.eks]
}

module "opensearch" {
  source = "./modules/opensearch"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  eks_node_sg_id     = module.eks.node_security_group_id
  instance_type      = var.opensearch_instance_type
  environment        = var.environment
  tags               = var.tags

  depends_on = [module.vpc, module.eks]
}

module "cloudflare" {
  source = "./modules/cloudflare"

  zone_id    = var.cloudflare_zone_id
  account_id = var.cloudflare_account_id
  environment = var.environment
}

module "vault" {
  source = "./modules/vault"

  namespace        = "vault"
  eks_cluster_name = module.eks.cluster_name
  environment      = var.environment
  tags             = var.tags

  depends_on = [module.eks]
}

module "observability" {
  source = "./modules/observability"

  namespace        = "monitoring"
  eks_cluster_name = module.eks.cluster_name
  environment      = var.environment
  tags             = var.tags

  depends_on = [module.eks]
}
