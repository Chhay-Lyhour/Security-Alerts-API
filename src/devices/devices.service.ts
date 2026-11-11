import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LOGIN_RULES, type DeviceStatus } from '../auth/detection/login-rules.js';
import { Device } from './entities/device.entity.js';

export interface DeviceCheck {
  status: DeviceStatus;
  device: Device | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DevicesService {
  constructor(@InjectRepository(Device) private readonly devices: Repository<Device>) {}

  /**
   * SPECS.md section 6, step 2. Read-only: nothing is saved until the login
   * is actually allowed (see recordLogin), so a blocked attacker's device
   * never becomes "known".
   */
  async classify(userId: string, fingerprint: string, now: Date): Promise<DeviceCheck> {
    const device = await this.devices.findOne({ where: { userId, fingerprint } });
    if (!device) return { status: 'new', device: null };

    const idleMs = now.getTime() - device.lastSeenAt.getTime();
    const status = idleMs >= LOGIN_RULES.returningDevice.inactiveDays * DAY_MS ? 'returning' : 'same';
    return { status, device };
  }

  /** Saves a new device as untrusted, or refreshes a known one. */
  async recordLogin(
    userId: string,
    check: DeviceCheck,
    seen: { fingerprint: string; name: string; ip: string; country: string | null },
    now: Date,
  ): Promise<Device> {
    if (check.device) {
      check.device.lastSeenAt = now;
      check.device.ipAddress = seen.ip;
      check.device.location = seen.country ?? check.device.location;
      return this.devices.save(check.device);
    }

    // orIgnore: two parallel logins from the same new device must not fail.
    await this.devices
      .createQueryBuilder()
      .insert()
      .values({
        userId,
        fingerprint: seen.fingerprint,
        name: seen.name,
        ipAddress: seen.ip,
        location: seen.country,
        firstSeenAt: now,
        lastSeenAt: now,
        isTrusted: false,
      })
      .orIgnore()
      .execute();
    return this.devices.findOneOrFail({ where: { userId, fingerprint: seen.fingerprint } });
  }

  findForUser(userId: string): Promise<Device[]> {
    return this.devices.find({ where: { userId }, order: { lastSeenAt: 'DESC' } });
  }

  async trust(userId: string, id: string): Promise<Device> {
    const device = await this.findOwned(userId, id);
    device.isTrusted = true;
    return this.devices.save(device);
  }

  /** Forget a device. Its next login counts as a new device again. */
  async revoke(userId: string, id: string): Promise<void> {
    const device = await this.findOwned(userId, id);
    await this.devices.remove(device);
  }

  /** 404 (not 403) for other users' devices, so IDs cannot be probed. */
  private async findOwned(userId: string, id: string): Promise<Device> {
    const device = await this.devices.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }
}
