import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../users/entities/user-role.enum.js';
import type { User } from '../users/entities/user.entity.js';
import { hashPassword } from '../users/password.util.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { RequestContext } from './detection/request-context.js';
import type { LoginDetectorService, RecordAttemptInput } from './login-detector.service.js';
import type { RefreshTokensService } from './refresh-tokens.service.js';

const ctx: RequestContext = { ip: '203.0.113.7', userAgent: 'vitest', country: null, deviceId: null };

const storedUser = async (password: string): Promise<User> => ({
  id: 'user-1',
  email: 'analyst@example.com',
  passwordHash: await hashPassword(password),
  role: UserRole.ANALYST,
  timezone: null,
  createdAt: new Date(),
});

describe('AuthService', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  let usersService: {
    findById: ReturnType<typeof vi.fn>;
    findByEmail: ReturnType<typeof vi.fn>;
    findByEmailWithPassword: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let refreshTokens: {
    issue: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
    revokeAllForUser: ReturnType<typeof vi.fn>;
  };
  let loginDetector: {
    assertNotLocked: ReturnType<typeof vi.fn>;
    recordAttempt: ReturnType<typeof vi.fn>;
  };
  let service: AuthService;

  beforeEach(() => {
    usersService = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      findByEmailWithPassword: vi.fn(),
      create: vi.fn(),
    };
    refreshTokens = {
      issue: vi.fn().mockResolvedValue('rt_new'),
      rotate: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllForUser: vi.fn(),
    };
    // By default login detection lets every attempt through unchanged.
    loginDetector = {
      assertNotLocked: vi.fn().mockResolvedValue(undefined),
      recordAttempt: vi
        .fn()
        .mockImplementation(async (input: RecordAttemptInput) => ({
          issueToken: input.success,
          revokeSessions: false,
        })),
    };
    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService,
      refreshTokens as unknown as RefreshTokensService,
      loginDetector as unknown as LoginDetectorService,
      new ConfigService({ JWT_ACCESS_EXPIRES_IN_SECONDS: '900' }),
    );
  });

  describe('register', () => {
    it('creates an analyst and returns both tokens without the password hash', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(await storedUser('x'));

      const result = await service.register({
        email: 'analyst@example.com',
        password: 'long-enough-password',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ role: expect.anything() }),
      );
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        refreshToken: 'rt_new',
      });
      expect(jwtService.verify(result.accessToken)).toMatchObject({
        sub: 'user-1',
        role: UserRole.ANALYST,
      });
    });

    it('rejects a duplicate email with 409', async () => {
      usersService.findByEmail.mockResolvedValue(await storedUser('x'));
      await expect(
        service.register({ email: 'analyst@example.com', password: 'long-enough-password' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('returns tokens for correct credentials and starts a new session', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(await storedUser('correct-pass'));
      const result = await service.login(
        {
          email: 'analyst@example.com',
          password: 'correct-pass',
        },
        ctx,
      );
      expect(jwtService.verify(result.accessToken).sub).toBe('user-1');
      expect(refreshTokens.issue).toHaveBeenCalledWith('user-1');
      expect(loginDetector.recordAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'analyst@example.com', success: true, ctx }),
      );
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      usersService.findByEmailWithPassword.mockResolvedValueOnce(await storedUser('correct-pass'));
      const wrongPassword = service.login({ email: 'analyst@example.com', password: 'nope' }, ctx);
      await expect(wrongPassword).rejects.toThrow(UnauthorizedException);
      await expect(wrongPassword).rejects.toThrow('Invalid credentials');

      usersService.findByEmailWithPassword.mockResolvedValueOnce(null);
      const unknownEmail = service.login({ email: 'ghost@example.com', password: 'nope' }, ctx);
      await expect(unknownEmail).rejects.toThrow('Invalid credentials');
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('denies the token and ends all sessions when login detection says so (rule 3)', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(await storedUser('correct-pass'));
      loginDetector.recordAttempt.mockResolvedValue({ issueToken: false, revokeSessions: true });

      await expect(
        service.login({ email: 'analyst@example.com', password: 'correct-pass' }, ctx),
      ).rejects.toThrow('Invalid credentials');
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('stops before checking the password while the email or IP is locked', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(await storedUser('correct-pass'));
      loginDetector.assertNotLocked.mockRejectedValue(new HttpException('locked', 429));

      await expect(
        service.login({ email: 'analyst@example.com', password: 'correct-pass' }, ctx),
      ).rejects.toThrow(HttpException);
      expect(loginDetector.recordAttempt).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('returns a new access token and the rotated refresh token', async () => {
      refreshTokens.rotate.mockResolvedValue({ userId: 'user-1', refreshToken: 'rt_rotated' });
      usersService.findById.mockResolvedValue(await storedUser('x'));

      const result = await service.refresh('rt_old');

      expect(result.refreshToken).toBe('rt_rotated');
      expect(jwtService.verify(result.accessToken).sub).toBe('user-1');
    });

    it('rejects when the user no longer exists', async () => {
      refreshTokens.rotate.mockResolvedValue({ userId: 'gone', refreshToken: 'rt_rotated' });
      usersService.findById.mockResolvedValue(null);
      await expect(service.refresh('rt_old')).rejects.toThrow(UnauthorizedException);
    });
  });
});
