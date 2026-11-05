import {reachByKeyboard} from './keyboard-qa.js';
import type {Page} from '@playwright/test';

/** Exercise WordPress login while landing directly on the assigned admin task. */
export async function loginClientAdmin(page:Page,origin:string,credentials:{username:string;password:string},destination='/wp-admin/edit.php?post_type=product'){
 const target=new URL(destination,origin);
 if(target.origin!==origin||!target.pathname.startsWith('/wp-admin/')||target.username||target.password||target.hash)throw new Error('admin_qa_login_destination_invalid');
 const login=new URL('/wp-login.php',origin);login.searchParams.set('redirect_to',target.href);
 await page.goto(login.href,{waitUntil:'load'});
 await reachByKeyboard(page,page.locator('#user_login'));await page.locator('#user_login').fill(credentials.username);
 await reachByKeyboard(page,page.locator('#user_pass'));await page.locator('#user_pass').fill(credentials.password);
 await reachByKeyboard(page,page.locator('#wp-submit'));await page.locator('#wp-submit').press('Enter');
 await page.waitForURL(url=>url.origin===origin&&url.pathname===target.pathname&&[...target.searchParams].every(([key,value])=>url.searchParams.get(key)===value));
 await page.waitForLoadState('load');
}
