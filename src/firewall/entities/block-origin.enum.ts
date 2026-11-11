export enum BlockOrigin {
  /** Added by an admin through POST /firewall/blocked-ips. */
  MANUAL = 'manual',
  /** Added by the firewall when a rule escalated a high or critical alert. */
  AUTO = 'auto',
}
