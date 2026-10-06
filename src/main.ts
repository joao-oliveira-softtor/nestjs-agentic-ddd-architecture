import { NestFactory } from '@nestjs/core';
import { BunAdapter, type NestBunApplication } from '@nestbun/platform';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestBunApplication>(
    AppModule,
    new BunAdapter(),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
