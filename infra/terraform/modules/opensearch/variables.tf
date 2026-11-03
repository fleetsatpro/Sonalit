variable "name_prefix" {
  type        = string
  description = "Resource name prefix"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for OpenSearch"
}

variable "eks_node_sg_id" {
  type        = string
  description = "EKS node security group ID (allowed inbound)"
}

variable "instance_type" {
  type        = string
  default     = "r6g.large.search"
  description = "OpenSearch instance type"
}

variable "instance_count" {
  type        = number
  default     = 3
  description = "Number of OpenSearch data nodes"
}

variable "volume_size" {
  type        = number
  default     = 100
  description = "EBS volume size in GB per node"
}

variable "engine_version" {
  type        = string
  default     = "OpenSearch_2.13"
  description = "OpenSearch engine version"
}

variable "environment" {
  type        = string
  description = "Environment"
}

variable "tags" {
  type        = map(string)
  default     = {}
}
