terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name       = "sonalit-media-${var.environment}"
  location   = "EEUR"
}

resource "cloudflare_r2_bucket" "reports" {
  account_id = var.account_id
  name       = "sonalit-reports-${var.environment}"
  location   = "EEUR"
}

resource "cloudflare_dns_record" "api" {
  zone_id = var.zone_id
  name    = var.environment == "prod" ? "api" : "api-${var.environment}"
  type    = "CNAME"
  content = "sonalit-api.${var.environment}.internal"
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "realtime" {
  zone_id = var.zone_id
  name    = var.environment == "prod" ? "rt" : "rt-${var.environment}"
  type    = "CNAME"
  content = "sonalit-realtime.${var.environment}.internal"
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "web" {
  zone_id = var.zone_id
  name    = var.environment == "prod" ? "@" : var.environment
  type    = "CNAME"
  content = "sonalit-web.${var.environment}.internal"
  proxied = true
  ttl     = 1
}
