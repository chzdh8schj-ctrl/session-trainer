// Необязательный UI-тест (нужен установленный chromium, см. ../README.md).
// Логин → добавить предмет → увидеть его → удалить.
import { expect, test } from '@playwright/test';

const password = process.env.SITE_PASSWORD || '';
const subjectName = `e2e-ui-${Date.now()}`;

test('логин, добавление предмета и его видимость', async ({ page }) => {
  test.skip(!password, 'SITE_PASSWORD не задан — пропускаю');

  page.on('dialog', (dialog) => void dialog.accept());

  await page.goto('/login');
  await page.getByPlaceholder('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByRole('heading', { name: 'Мои предметы' })).toBeVisible();

  await page.getByRole('button', { name: /Добавить предмет/ }).click();
  await page.locator('form input').first().fill(subjectName);
  await page.getByRole('button', { name: 'Создать' }).click();

  const card = page.locator('.card', { hasText: subjectName });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText(subjectName)).toHaveCount(0);
});
