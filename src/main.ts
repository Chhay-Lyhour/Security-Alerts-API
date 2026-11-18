import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.use(
    helmet({
      contentSecurityPolicy: {
        // Helmet's default CSP (scripts and styles from this origin only)
        // suits the dashboard. Upgrading requests to HTTPS is left to the
        // proxy, so the dashboard also loads over plain HTTP on a LAN.
        directives: { upgradeInsecureRequests: null },
      },
    }),
  );

  // The analyst dashboard: static files at /dashboard/. They are public; every
  // API call they make still needs a staff login.
  app.useStaticAssets(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'public'),
    {
      index: 'index.html',
      redirect: true,
    },
  );

  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) app.set('trust proxy', Number(trustProxy));

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
