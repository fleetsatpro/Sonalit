variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID"
}

variable "account_id" {
  type        = string
  description = "Cloudflare account ID"
}

variable "environment" {
  type        = string
  description = "Environment (prod/staging)"
}
