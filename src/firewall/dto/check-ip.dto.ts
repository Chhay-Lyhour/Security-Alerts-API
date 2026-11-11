import { IsIP } from 'class-validator';

/** Body of POST /firewall/check, sent by an integrated app before it lets a user in. */
export class CheckIpDto {
  @IsIP()
  ip: string;
}
