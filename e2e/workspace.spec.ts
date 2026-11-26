import {expect,test} from "@playwright/test";

test("customer can navigate activity and export a statement",async({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:"Customer demo"}).click();
  await expect(page.getByRole("heading",{name:"Welcome back, Ava"})).toBeVisible();
  await expect(page.getByText("Simulated USD",{exact:true})).toBeVisible();
  await expect(page.getByText("Project reimbursement")).toBeVisible();
  await page.getByRole("navigation",{name:"Workspace"}).getByRole("button",{name:"Statements"}).click();
  const [download]=await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button",{name:"Export CSV"}).click(),
  ]);
  expect(download.suggestedFilename()).toBe("fincore-statement.csv");
});

test("invalid transfer amount is rejected before confirmation",async({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:"Customer demo"}).click();
  await page.getByRole("button",{name:"Send money"}).click();
  const dialog=page.getByRole("dialog",{name:"Send money"});
  await dialog.getByLabel("Recipient").selectOption({label:"Jordan Lee"});
  await dialog.getByLabel("Amount (USD)",{exact:true}).fill("10.123");
  await dialog.getByLabel("Confirm password").fill("FinCoreDemo!2026");
  await dialog.getByLabel("Simulation code").fill("246810");
  await dialog.getByRole("button",{name:"Send money"}).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter an amount between $0.01 and $1,000,000.00.");
  await dialog.getByRole("button",{name:"Close dialog"}).click();
  await expect(dialog).toHaveCount(0);
});

test("operations views remain accessible on mobile",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await page.getByRole("button",{name:"Operations demo"}).click();
  await expect(page.getByRole("heading",{name:"Operations",exact:true})).toBeVisible();
  await expect(page.getByText("Ledger net")).toBeVisible();
  await expect(page.getByRole("heading",{name:"Provider reconciliation"})).toBeVisible();
  await page.getByRole("button",{name:"Toggle navigation"}).click();
  await page.getByRole("navigation",{name:"Workspace"}).getByRole("button",{name:"Disputes"}).click();
  await expect(page.getByRole("heading",{name:"Disputes",exact:true})).toBeVisible();
});
