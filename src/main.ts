import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Security headers. Also removes X-Powered-By.
  app.use(helmet());

  // Behind a reverse proxy, every request would otherwise appear to come from
  // the proxy's IP, so all clients would share one rate limit and logs would
  // lose the real IP. Set it to the exact hop count: trusting more hops lets
  // clients spoof their IP through X-Forwarded-For.
  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) app.set('trust proxy', Number(trustProxy));

  // CORS stays off (browsers cannot call the API cross-origin) unless
  // specific origins are listed. Server-to-server callers are unaffected.
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      credentials: false,
      maxAge: 600,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(config.get<string>('PORT') ?? 3000);
}

await bootstrap();
