import {test,expect} from '@playwright/test';

test('keyboard edits both layers, restores one key and retains settings after reopening',async({page})=>{
  await page.goto('/?view=keyboard');
  const key=page.getByRole('button',{name:'按键 F12',exact:true});await expect(key).toBeEnabled();await key.click();
  await page.getByLabel('目标按键',{exact:true}).selectOption('104');await page.getByRole('button',{name:'保存按键',exact:true}).click();
  await expect(page.getByText('当前：F13',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回总览'}).click();await page.getByRole('button',{name:'键盘设置',exact:true}).click();await key.click();await expect(page.getByText('当前：F13',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'恢复原键',exact:true}).click();await expect(page.getByText('当前：F12',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Fn 层',exact:true}).click();await expect(key).toBeEnabled();
  const previous=await page.locator('.key-detail__identity>span').innerText();
  await page.getByLabel('按键功能',{exact:true}).selectOption('media');await page.getByLabel('媒体功能',{exact:true}).selectOption('205');await page.getByRole('button',{name:'保存按键',exact:true}).click();
  await expect(page.getByText('当前：播放 / 暂停',{exact:true})).toBeVisible();await page.getByRole('button',{name:'撤销本次修改',exact:true}).click();await expect(page.locator('.key-detail__identity span')).toHaveText(previous);
  await page.getByRole('checkbox',{name:'锁定 Win 键'}).click();await expect(page.getByRole('checkbox',{name:'锁定 Win 键'})).toBeChecked();
});

test('macro recording, editing, binding and removal complete through the UI',async({page})=>{
  await page.goto('/?view=mouse');await page.getByRole('tab',{name:'宏',exact:true}).click();
  await expect(page.getByRole('button',{name:'录制键盘',exact:true})).toBeEnabled();
  await page.getByLabel('宏名称',{exact:true}).fill('测试复制');await page.getByRole('button',{name:'录制键盘',exact:true}).click();
  await page.keyboard.press('Control+c');await page.keyboard.press('Escape');
  await expect(page.locator('.macro-editor')).toBeVisible();await expect(page.getByRole('button',{name:'录制键盘',exact:true})).toBeEnabled();await expect(page.getByLabel('宏动作',{exact:true})).toContainText('C · 松开');
  await page.getByRole('button',{name:'保存宏',exact:true}).click();await expect(page.getByText('宏已保存，可在按键页绑定使用。',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'按键',exact:true}).click();const row=page.locator('.mouse-binding').filter({has:page.getByText('后退侧键',{exact:true})});
  await row.getByRole('combobox').selectOption({label:'测试复制'});await row.getByRole('button',{name:'应用',exact:true}).click();await expect(row.locator('.mouse-binding__name span')).toHaveText('测试复制');
  await page.getByRole('tab',{name:'宏',exact:true}).click();await page.getByRole('button',{name:'删除宏',exact:true}).click();await expect(page.getByText('这个宏仍被按键使用，请先解除绑定。',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'按键',exact:true}).click();await row.getByRole('button',{name:'恢复默认',exact:true}).click();await expect(row.locator('.mouse-binding__name span')).toHaveText('后退');
  await page.getByRole('tab',{name:'宏',exact:true}).click();await page.getByRole('button',{name:'删除宏',exact:true}).click();await expect(page.getByRole('button',{name:'测试复制',exact:true})).toHaveCount(0);
});
