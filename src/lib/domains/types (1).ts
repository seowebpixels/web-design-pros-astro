/**
 * Domain availability types — WDP Phase 2 (RDAP backend).
 *
 * IMPORTANT: RDAP availability is informational only. It does NOT reserve
 * or register a domain, and does NOT guarantee the domain will remain
 * available by the time WDP manually completes a purchase through the
 * registrar. See checkDomainAvailability.ts for the full rationale.
 */

/** The only three states the public API is allowed to report. */
export type DomainAvailabilityStatus = 'available' | 'taken' | 'unknown';

/** Internal result shape produced by the availability-check pipeline. */
export interface DomainAvailabilityResult {
  domain: string;
  status: DomainAvailabilityStatus;
}

/** Error codes the public endpoint may report for invalid client input. */
export type DomainCheckError =
  | 'missing_domain'
  | 'invalid_domain'
  | 'subdomain_not_registrable'
  | 'method_not_allowed';

export interface DomainCheckSuccessResponse {
  success: true;
  domain: string;
  status: DomainAvailabilityStatus;
}

export interface DomainCheckErrorResponse {
  success: false;
  domain: null;
  status: 'unknown';
  error: DomainCheckError;
}

export type DomainCheckResponse = DomainCheckSuccessResponse | DomainCheckErrorResponse;
