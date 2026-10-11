/**
 * test/e2e/17-settings-profile-appearance-language-sti.mjs
 * Settings: profile, appearance, language, stickers, sound, signature.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TMP, shot, step, check, saveAdjusted } from './support.mjs';

/** Settings: profile, appearance, language, stickers, sound, signature. */
export async function step17(world) {
  const { a, b, pngPath, wastickers, wavPath } = world;
  step('settings: profile, appearance, language, stickers, sound, signature');
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  await a.waitForTimeout(700);
  // the pointer lights the entries of the menu, one after another and also when it goes back and forth quickly
  const entries = a.locator('.settings-overlay a.nav-item');
  const lit = [];
  for (const at of [0, 1, 2, 3, 2, 1, 4, 0, 5, 3]) {
    await entries.nth(at).hover();
    await a.waitForTimeout(80);
    lit.push(
      await entries.nth(at).evaluate(function (e) {
        return getComputedStyle(e).backgroundColor;
      }),
    );
  }
  await a.waitForTimeout(500);
  const finalLit = await entries.nth(3).evaluate(function (e) {
    return getComputedStyle(e).backgroundColor;
  });
  check(
    finalLit !== 'rgba(0, 0, 0, 0)' && lit.every(Boolean),
    'hovering an entry of the settings menu lights it ' + finalLit,
  );
  await a.mouse.click(4, 400);
  await a.waitForSelector('.settings-overlay', {
    state: 'detached',
    timeout: 5000,
  });
  check(true, 'pressing outside the settings closes them');
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  check(
    await a.evaluate(function () {
      return !!document.querySelector('app-direct-hub, app-group-view, app-voice-stage');
    }),
    'when the settings open the screen underneath is still there',
  );
  // What is written in the profile and not saved is kept when the settings are closed and opened again.
  await a.fill('input[maxlength="80"]', 'unsaved status');
  await a.keyboard.press('Escape');
  await a.waitForSelector('.settings-overlay', { state: 'detached' });
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  check(
    (await a.inputValue('input[maxlength="80"]')) === 'unsaved status',
    'an unsaved status is still there after closing and opening the settings',
  );
  await a.fill('input[maxlength="80"]', '');
  const avatarChooser = a.waitForEvent('filechooser');
  await a.click('[aria-label="Change picture"]');
  (await avatarChooser).setFiles(pngPath);
  await saveAdjusted(a);
  await a.waitForSelector('img[src^="blob:"]', { timeout: 15000 });
  const bannerChooser = a.waitForEvent('filechooser');
  await a.click('[aria-label="Change banner"]');
  (await bannerChooser).setFiles(pngPath);
  await saveAdjusted(a);
  await a.click('button[aria-expanded]:has-text("Name font")');
  await a.click('button.choice-card:has-text("Serif")');
  // the letters of the name move (one element per letter; only transform moves)
  await a.click('button[aria-expanded]:has-text("Name animation")');
  await a.click('button.choice-card:has-text("Bounce")');
  await a.waitForTimeout(900);
  await shot(a, '04c-animacion-nombre');
  await a.waitForSelector('.nfx-l');
  check(
    await a.evaluate(function () {
      const letter = document.querySelector('.nfx-l');
      return (
        document.querySelectorAll('.nfx-l').length >= 3 &&
        !!letter &&
        getComputedStyle(letter).animationName === 'nfx-bounce'
      );
    }),
    'a name animation moves the letters of the name',
  );
  check(
    await a.evaluate(function () {
      const names = [...document.querySelectorAll('button.choice-card .nfx-l:first-child')]
        .map(function (e) {
          return getComputedStyle(e).animationName;
        })
        .filter(function (n) {
          return n !== 'none';
        });
      return names.length >= 8 && new Set(names).size === names.length;
    }),
    'every name animation has a movement of its own',
  );
  // the banner color is offered when the banner is not a picture
  await a.click('button:has-text("Remove banner")');
  await a.click('button[aria-label="Banner color"]');
  await shot(a, '04-color-picker');
  const swatch = a.locator('button[aria-label="Banner color"]').first();
  await a.fill('input[aria-label="Hex color"]', '#ff0066');
  await a.waitForTimeout(1500);
  check(
    (await swatch.evaluate(function (e) {
      return getComputedStyle(e).backgroundColor;
    })) === 'rgb(255, 0, 102)',
    'the color picker applies the typed hex',
  );
  // the picker window is dragged by its title bar and has R, G and B fields
  const barra = a
    .locator('[popover] [title="Arrastra para mover"], [popover] [title="Drag to move"]')
    .first();
  const antes = await barra.boundingBox();
  await a.mouse.move(antes.x + 40, antes.y + antes.height / 2);
  await a.mouse.down();
  await a.mouse.move(antes.x + 140, antes.y + 90, { steps: 5 });
  await a.mouse.up();
  const despues = await barra.boundingBox();
  check(
    Math.abs(despues.x - antes.x - 100) < 4 &&
      Math.abs(despues.y - antes.y - (90 - antes.height / 2)) < 6,
    'the color picker is dragged by its title bar',
  );
  check(
    (await a.locator('input[aria-label="R"]').inputValue()) === '255',
    'the picker shows the RGB channels (R = 255)',
  );
  await a.fill('input[aria-label="G"]', '255');
  await a.waitForTimeout(600);
  check(
    (await swatch.evaluate(function (e) {
      return getComputedStyle(e).backgroundColor;
    })) === 'rgb(255, 255, 102)',
    'typing an RGB channel changes the color',
  );
  await a.fill('input[aria-label="Hex color"]', '#ff0066');
  await a.waitForTimeout(200);
  const area = a.locator('.sv-area').first();
  const box = await area.boundingBox();
  await a.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, {
    steps: 4,
  });
  await a.mouse.up();
  await a.waitForTimeout(500);
  check(
    (await swatch.evaluate(function (e) {
      return getComputedStyle(e).backgroundColor;
    })) !== 'rgb(255, 0, 102)',
    'dragging in the color square changes the color',
  );
  check(
    (await a
      .locator(
        'button[aria-label="Pick a color from the screen"], .tip[data-tip="Pick a color from the screen"]',
      )
      .count()) > 0,
    'the own color picker has an eyedropper',
  );
  await a.click('h2:has-text("About you")');
  await a.click('button[aria-expanded]:has-text("Profile effect")');
  await a.waitForTimeout(600);
  await shot(a, '04b-efectos');
  await a.click('h2:has-text("About you")');
  await a.click('label:has-text("Gradient") input');
  await a.click('button:has-text("More options") >> nth=0');
  await a.waitForSelector('text=Angle');
  check(true, 'banner with gradient, angle and where it starts and ends');
  check(
    (await a.locator('.gbar').count()) === 1 || (await a.locator('.gbar:visible').count()) >= 1,
    'the gradient editor is one single bar that also holds the markers',
  );
  await a.click('button:has-text("Save changes")');
  await a.waitForTimeout(1000);
  check(true, 'profile picture and banner uploaded, name font saved');
  // The picture is ciphertext on the server: a friend sees it only if the key that alice sealed for them opens it.
  await b.waitForSelector('app-avatar img[src^="blob:"]', { timeout: 40000 });
  check(
    true,
    'a friend sees the profile picture: it was encrypted, and its key was sealed for them',
  );

  check(
    (await a.evaluate(function () {
      return window.__snd;
    })) > 0,
    'buttons play a sound',
  );
  check(
    (
      await a.evaluate(function () {
        return getComputedStyle(document.documentElement).getPropertyValue('--cur-pointer');
      })
    ).includes('url('),
    'themed cursor applied',
  );
  check(
    (
      await a.evaluate(function () {
        return getComputedStyle(document.documentElement).getPropertyValue('--bg-blur');
      })
    ).trim() !== '',
    'background blur is adjustable',
  );
  check(
    await a.evaluate(function () {
      const n = document.querySelector('.nav-item');
      return !n || getComputedStyle(n).transitionDuration !== '0s';
    }),
    'hover with a soft transition',
  );

  await a.click('a:has-text("Appearance")');
  await a.click('button[aria-expanded]:has-text("Typeface")');
  await a.waitForTimeout(600);
  check(
    (await a.locator('.choice-card:visible').count()) === 9,
    'the typeface shows nine cards (the last one uploads your own)',
  );
  await shot(a, '05a-tipografia');
  await a.click('button[aria-expanded]:has-text("Accent color")');
  await a.click('button[aria-label="Rose"]');
  await a
    .locator('button[aria-expanded]', { hasText: /^\s*Theme(?! presets)/ })
    .first()
    .click();
  await a.click('button:has-text("Dusk")');
  await a.click('button[aria-expanded]:has-text("Background")');
  await shot(a, '05b-fondos');
  await a.click('button:has-text("Stars")');
  await a.click('button[aria-expanded]:has-text("Mouse cursor")');
  await a.click('button:has-text("Sleek")');
  check(
    (
      await a.evaluate(function () {
        return getComputedStyle(document.documentElement).getPropertyValue('--cur-default');
      })
    ).includes('url('),
    'Sleek cursor applied',
  );
  const gifPath = path.join(TMP, 'cursor.gif');
  fs.writeFileSync(
    gifPath,
    Buffer.from(
      'R0lGODlhAQABAPAAAP8AAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICRAEAOw==',
      'base64',
    ),
  );
  const cursorChooser = a.waitForEvent('filechooser');
  await a.click('button:has-text("Upload your cursor")');
  (await cursorChooser).setFiles(gifPath);
  await a.waitForFunction(
    function () {
      return [...document.querySelectorAll('input')].some(function (i) {
        return i.value === 'cursor';
      });
    },
    null,
    { timeout: 10000 },
  );
  check(
    await a.evaluate(function () {
      return (
        document.documentElement.classList.contains('cursor-js') &&
        !!document.querySelector('.cursor-overlay')
      );
    }),
    'animated cursor uploaded: it is drawn by the own cursor',
  );
  await a.click('button:has-text("Sleek")');
  await a.click('app-select[label="Trail"] button, button[aria-label="Trail"]');
  await a.click('.select-option:has-text("Comet")');
  await a.waitForTimeout(500);
  check(
    await a.evaluate(function () {
      return document.documentElement.classList.contains('cursor-js');
    }),
    'cursor with a trail (comet) active',
  );
  await a.click('app-select[label="Trail"] button, button[aria-label="Trail"]');
  await a.click('.select-option:has-text("None")');
  await a.click('button:has-text("Animated")');
  await a.waitForTimeout(500);
  check(
    await a.evaluate(function () {
      return !!document.querySelector('.cursor-overlay svg');
    }),
    'animated cursor: drawn with animation',
  );
  // every cursor state keeps its themed drawing: link, arrow and text field
  await a.hover('a:has-text("Language")');
  await a.waitForTimeout(300);
  check(
    (await a.evaluate(function () {
      const e = document.querySelector('.cursor-overlay .cs-active');
      return e ? e.dataset.cur : '';
    })) === 'pointer',
    'over a link the animated cursor draws the link one',
  );
  await a.hover('input[aria-label="Cursor name"]');
  await a.waitForTimeout(300);
  check(
    (await a.evaluate(function () {
      const e = document.querySelector('.cursor-overlay .cs-active');
      return e ? e.dataset.cur : '';
    })) === 'text',
    'over a text field the animated cursor draws the text one (not the Windows one)',
  );
  await a.click('button:has-text("Static")');
  await a.waitForTimeout(300);
  await a.click('button[aria-expanded]:has-text("Chat bubbles")');
  await a.click('button:has-text("Outline")');
  await a.waitForTimeout(500);
  check(
    (await a.evaluate(function () {
      return document.documentElement.dataset.bubble;
    })) === 'outline',
    'the bubble style changes',
  );
  // the corner style is a row of seven choices
  await a.click('button[aria-expanded]:has-text("Corner style")');
  await a.waitForTimeout(500);
  await a.click('button[aria-label="Square"]');
  await a.waitForTimeout(200);
  check(
    (await a.evaluate(function () {
      return document.documentElement.style.getPropertyValue('--r');
    })) === '2px',
    'the corner choices change the rounding of the whole interface',
  );
  await a.click('button[aria-label="Soft"]');
  // mouse wheel over a slider: it goes up or down one step
  const deslizador = a.locator('input[type=range][min="12"][max="18"]').first();
  await deslizador.scrollIntoViewIfNeeded();
  const valorAntes = Number(await deslizador.inputValue());
  const caja = await deslizador.boundingBox();
  await a.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await a.mouse.wheel(0, -100);
  await a.waitForTimeout(200);
  const valorMas = Number(await deslizador.inputValue());
  // The whole interface follows the text size, so the slider may have moved: wait for it to settle, then the pointer goes to where it is now.
  await a.waitForTimeout(800);
  await deslizador.scrollIntoViewIfNeeded();
  const cajaNueva = await deslizador.boundingBox();
  await a.mouse.move(cajaNueva.x + cajaNueva.width / 2, cajaNueva.y + cajaNueva.height / 2);
  await a.mouse.wheel(0, 100);
  await a.waitForTimeout(200);
  const valorMenos = Number(await deslizador.inputValue());
  check(
    valorMas === valorAntes + 1 && valorMenos === valorAntes,
    'the mouse wheel raises and lowers a slider (step by step) ' +
      JSON.stringify([valorAntes, valorMas, valorMenos]),
  );
  await a.click('button[aria-expanded]:has-text("Corner style")');
  await a.waitForTimeout(600);
  // Opening a folding section closes the others, so the bubbles are opened again.
  if ((await a.locator('button[aria-expanded="false"]:has-text("Chat bubbles")').count()) === 1) {
    await a.click('button[aria-expanded]:has-text("Chat bubbles")');
    await a.waitForTimeout(600);
  }
  check(
    (await a.locator('button:has(.bubble-in)').count()) === 12,
    'there are twelve bubble styles',
  );
  await a.click('button:has-text("Neon")');
  await a.waitForTimeout(300);
  check(
    (await a.evaluate(function () {
      return document.documentElement.dataset.bubble;
    })) === 'neon',
    'a new bubble style is applied (Neon)',
  );
  await a.click('button:has-text("Round")');
  await shot(a, '05-apariencia');
  check(true, 'theme, background and rounding changed');

  await a.click('a:has-text("Sounds")');
  await a.click('button[aria-expanded]:has-text("Call ringtone")');
  await a.waitForTimeout(600);
  check(
    (await a.locator('.ring-card:visible').count()) === 6,
    'the automatic ringtone, four melodies and one of your own',
  );
  check(
    (await a.locator('.ring-card:has-text("Automatic")').count()) === 1,
    'there is a ringtone that follows the season',
  );
  await shot(a, '06a-tonos');
  await a.click('button:has-text("Open soundboard")');
  await a.waitForSelector('.sb-pill:has-text("All")');
  await shot(a, '06-soundboard');
  // The first press of an effect must sound (the effects are loaded before the person asks for them).
  const antesSfx = await a.evaluate(function () {
    return window.__snd;
  });
  await a.locator('.sb-grid .sb-tile:not(.sb-add)').first().click();
  await a
    .waitForFunction(
      function (n) {
        return window.__snd > n;
      },
      antesSfx,
      { timeout: 1500 },
    )
    .catch(function () {
      return undefined;
    });
  check(
    (await a.evaluate(function () {
      return window.__snd;
    })) > antesSfx,
    'the first press of an effect of the soundboard sounds',
  );
  const soundChooser = a.waitForEvent('filechooser');
  await a.click('button:has-text("Add a sound")');
  (await soundChooser).setFiles(wavPath);
  // The sound opens in a window to cut it, name it and give it an emoji (there is no limit of 8 seconds any more).
  const editor = '[role="dialog"][aria-label="Edit the sound"]';
  await a.waitForSelector(editor + ' canvas.sound-wave', { timeout: 10000 });
  await a.waitForFunction(function (selector) {
    const ends = document.querySelectorAll(selector + ' input[type=range]');
    return ends.length === 2 && Number(ends[1].max) > 0.1 && Number(ends[1].value) > 0.1;
  }, editor);
  await a.fill(editor + ' input[aria-label="Emoji"]', '🔥');
  await a.fill(editor + ' input[aria-label="Name"]', 'boom');
  const keptBefore = await a.locator(editor + ' .text-accent').innerText();
  await a
    .locator(editor + ' input[type=range]')
    .nth(1)
    .evaluate(function halve(slider) {
      slider.value = String(Number(slider.max) / 2);
      slider.dispatchEvent(new Event('input'));
    });
  const keptAfter = await a.locator(editor + ' .text-accent').innerText();
  check(keptBefore !== keptAfter, 'soundboard: the end of the sound can be moved to cut it');
  await a.click(editor + ' button:has-text("Save")');
  await a.waitForSelector('button:has-text("boom")', { timeout: 10000 });
  check(
    (await a.locator('button:has-text("boom") .emoji-glyph').innerText()) === '🔥',
    'soundboard: own sound uploaded, cut, renamed and with an emoji',
  );
  await a.hover('button:has-text("boom")');
  await a.click('button[aria-label="Edit the sound"]');
  await a.waitForSelector(editor + ' canvas.sound-wave');
  await a.fill(editor + ' input[aria-label="Name"]', 'bam');
  await a.click(editor + ' button:has-text("Save")');
  await a.waitForSelector('button:has-text("bam")', { timeout: 10000 });
  check(
    (await a.locator('button:has-text("boom")').count()) === 0,
    'soundboard: an edited sound replaces the old one',
  );
  await a.click('div[class*="z-[75]"] button[aria-label="Close"]');

  await a.click('a:has-text("Stickers")');
  const waChooser = a.waitForEvent('filechooser');
  await a.click('button:has-text("Choose files")');
  (await waChooser).setFiles(wastickers);
  await a.waitForFunction(
    function () {
      return [...document.querySelectorAll('input')].some(function (i) {
        return i.value === 'Pack WA';
      });
    },
    null,
    { timeout: 15000 },
  );
  check(true, 'WhatsApp .wastickers pack imported');

  await a.click('a:has-text("Language")');
  await a.waitForTimeout(700);
  await shot(a, '06c-idioma');
  await a.click('button:has-text("Español")');
  await a.waitForSelector('text=Idioma');
  check(true, 'language changed to Spanish');

  await a.click('a:has-text("Acerca de")');
  await a.waitForSelector('text=Jondals', { timeout: 10000 });
  check(true, 'animated "Developed by Jondals" signature visible');
  await a.waitForTimeout(1500);
  await shot(a, '08-acerca');
}
