// Text and screenshots for the user guide. Edit this file to change the guide; the page itself is UserGuide.tsx.
type Section = {
  id: string
  title: string
  summary: string
  image?: string
  alt?: string
  steps: string[]
  tip?: string
}

const img = (name: string) => `${import.meta.env.BASE_URL}guide/${name}.png`

export const GUIDE_SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Getting started',
    summary: 'Five things to do on your first day so everything works smoothly.',
    steps: [
      'Create your account and your business. You become the owner, and your 7-day free trial starts right away. No card is needed.',
      'Open Settings > Business profile and add your business name, logo, address and phone number. They appear on every receipt.',
      'Add the products you sell in Inventory, one by one or all at once with Import from CSV, then receive your opening stock.',
      'Add your regular customers in Customers (optional, but it keeps balances tidy).',
      'Record your first sale in Sales, then open Receipts to see the receipt.',
      'Before day 7 ends, open Settings > Billing and pay for the plan that fits you, so your business never pauses.',
    ],
  },
  {
    id: 'overview',
    title: 'Overview',
    summary:
      'Your daily snapshot. It shows revenue, gross profit, net profit and the cost of the goods you sold for the last 30 days, plus recent sales and anything running low.',
    image: img('01-overview'),
    alt: 'Overview page with revenue, profit, recent sales and low-stock items',
    steps: [
      'Use Record a sale (top right) to start a sale from anywhere.',
      'Check Running low to see products that need restocking.',
      'Tap View all next to Recent sales, or open Records, for the full history.',
      'The Revenue card compares today with yesterday and with the same weekday last week, because many shops sell very differently on different days.',
    ],
  },
  {
    id: 'sales',
    title: 'Recording a sale',
    summary: 'A sale is two steps: who it is for, then what they are buying.',
    image: img('02-sales'),
    alt: 'New sale page with a customer selected and the item cart',
    steps: [
      'Choose the customer. Their name stays attached while you add products.',
      'Pick a product and quantity, then press Add item. Repeat for each product.',
      'Choose how they paid: cash, bank transfer, card, mobile money, on credit, split or other.',
      'Complete the sale. The server checks totals and stock again, so the numbers are always right.',
    ],
    tip: 'If you leave in the middle of a sale, your draft is kept. If your internet drops, the sale is saved on your device and sent when you are back online.',
  },
  {
    id: 'inventory',
    title: 'Inventory',
    summary: 'Your product catalogue and stock levels.',
    image: img('03-inventory'),
    alt: 'Inventory table with products, stock levels, prices and branches',
    steps: [
      'Add product creates a new product with its cost price and selling price.',
      'Receive stock records new stock arriving and keeps a traceable history.',
      'Edit changes a product. Delete removes it from the catalogue.',
      'The stock label turns amber when a product reaches its reorder point and shows 0 left when it is out of stock. You get a notification inside the app when a product reaches its reorder point.',
      'Use Needs restocking and Out of stock above the list to see only those products.',
      'Import from CSV adds many products at once, and Count stock checks your shelves against the system. Both are explained next.',
    ],
    tip: 'Long lists show 50 at a time. Use Load more for older items, or the search box above the list to find one quickly. Purchase Orders lets you order stock from suppliers and receive it into inventory when it arrives.',
  },
  {
    id: 'import',
    title: 'Importing products from a spreadsheet',
    summary: 'Add your whole product list in one go instead of typing each product.',
    image: img('12-import'),
    alt: 'Inventory page with the Import from CSV panel open: download the template, then choose your file',
    steps: [
      'In Inventory, choose Import from CSV, then Download template.',
      'Open the template in Excel or Google Sheets. Fill in one product per row: name and selling price are required; SKU, category, cost price, stock and reorder level are optional. The columns can be in any order.',
      'Save the file as CSV (in Excel: File, Save as, CSV) and choose it in step 2.',
      'We check every row and list any problem in plain words, with the row number. Rows with a problem are skipped; fix them in your file and import again if you want them.',
      'Press Import. Everything is added together, or nothing is. Stock you typed becomes the opening stock of each new product.',
    ],
    tip: 'Leave SKU empty and we number the product for you (ITEM-000001 and so on). If a SKU already exists you can leave that product alone or update its name, category, price and reorder level. Importing never changes stock or cost price of an existing product. You can import up to 1,000 products per file.',
  },
  {
    id: 'count',
    title: 'Counting your stock',
    summary: 'Compare what is on your shelves with what the system says, and fix the difference with a record of why.',
    steps: [
      'In Inventory, choose Count stock, then Start a count. Pick a branch first if you work with more than one.',
      'Type what you really find for each product. Search or pick a category to count a section at a time. Leave a product empty if you did not count it, and type 0 if the shelf is empty.',
      'By default the system stock is hidden while you count, because counting without looking is more accurate. You can show it with the tick box.',
      'Press Review to see every difference and what it is worth at cost, add a note if you like, then Apply. The stock is set to what you counted and each change is written to your stock history as a Stock count adjustment.',
      'Past counts are listed under Stock counts at the bottom of Inventory, with the products that differed.',
    ],
    tip: 'Your numbers are saved on your device while you count, so a phone call or a closed tab never loses the work. Sales recorded while you count are not subtracted, so count when the shop is quiet. Only owners and managers can count stock.',
  },
  {
    id: 'customers',
    title: 'Customers',
    summary: 'A customer book with running balances.',
    image: img('04-customers'),
    alt: 'Customers table showing contact details and balance owed',
    steps: [
      'Add customer saves a name, phone, email and address.',
      'Balance owed shows what a customer still owes you from sales marked On credit.',
      'Record payment reduces their balance when they pay you.',
    ],
  },
  {
    id: 'receipts',
    title: 'Receipts',
    summary: 'Every completed sale has a receipt with your logo, business details, the customer and the items.',
    image: img('05-receipts'),
    alt: 'Receipts list with Preview, Download PDF and Share actions',
    steps: [
      'Preview shows the receipt on screen.',
      'Download PDF saves a copy you can print or send. Older receipts load 25 at a time with Load older receipts.',
      'Share sends the receipt to the customer.',
      'Receipts are grouped by day. Under Print receipts for, choose A4 page, 80 mm roll printer or 58 mm roll printer. Roll printer receipts are one narrow black and white page that prints cleanly on thermal rolls. Your choice is remembered on that device.',
    ],
    tip: 'Receipt numbers use your own prefix (for example AS-1001). Change the prefix and details in Settings > Business profile.',
  },
  {
    id: 'records',
    title: 'Records: day by day, monthly and yearly',
    summary: 'The full history of sales, expenses and stock coming in, the way a sales book is kept.',
    image: img('11-records'),
    alt: 'Records page showing completed sales day by day with totals and an Export CSV button',
    steps: [
      'Open Records and choose Sales, Expenses or Stock intake.',
      'Day by day shows each day with how many records it has and its total, newest first.',
      'Monthly and Yearly show one row per month or year, with a grand total. For sales you also see the average sale and the refunded amount. Export totals (CSV) saves the table for Excel.',
      'Use the Period filter to choose which dates are included.',
    ],
    tip: 'Totals count completed sales only. Refunded sales are listed with a red badge and shown separately. Days run from 12:00 am to 11:59 pm in your business time zone, which you can change in Settings > Reports.',
  },
  {
    id: 'expenses',
    title: 'Expenses',
    summary: 'Record the costs of running your business so profit is honest.',
    image: img('06-expenses'),
    alt: 'Expenses list with category, date and amount',
    steps: [
      'Record expense adds a cost with a title, category, date, amount and how you paid.',
      'Expenses flow into Reports as operating expenses and reduce net profit.',
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    summary: 'Choose a period and see how the business performed, calculated from your real records.',
    image: img('07-reports'),
    alt: 'Reports page with revenue, cost of goods, gross profit, expenses and net profit',
    steps: [
      'Pick 7 days, 30 days, 12 months, or set your own From and To dates.',
      'Revenue is what you sold. Cost of goods is what that stock cost you. Gross profit is the difference.',
      'Net profit is gross profit minus your operating expenses.',
      'Below the figures, Best sellers ranks your products by units sold in the period, and Slow movers lists products you still hold that did not sell at all, with the most money tied up first.',
    ],
  },
  {
    id: 'settings',
    title: 'Business profile',
    summary: 'Make your receipts look professional.',
    image: img('08-settings-business'),
    alt: 'Settings business profile with logo, contact details and a receipt preview',
    steps: [
      'Upload a PNG, JPG or WEBP logo (up to 2 MB). It saves as soon as it uploads.',
      'Fill in your address, phone, email and website.',
      'Set your receipt prefix and tax rate, then press Save changes.',
      'The Receipt preview at the top updates as you type.',
    ],
  },
  {
    id: 'billing',
    title: 'Plans and billing',
    summary: 'Try free for 7 days, then pay to keep going.',
    image: img('09-settings-billing'),
    alt: 'Billing tab showing the current plan, its limits and available plans',
    steps: [
      'Settings > Billing shows how many days are left in your free trial, or your current plan and its limits.',
      'Pay with Paystack opens a secure Paystack page. Your plan changes only after Paystack confirms the payment.',
      'Each payment covers one month and does not renew by itself. Renew from the same screen.',
      'Every business gets one free 7-day trial. When the trial or a paid month ends your business becomes read-only until you pay, and your records stay safe.',
    ],
    tip: 'Charged but your plan did not change? Wait a few minutes, press Check again if you see it, then message Support with your Paystack receipt.',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    summary: 'Alerts for low and out-of-stock products and other important messages.',
    image: img('10-notifications'),
    alt: 'Notification panel listing low stock alerts',
    steps: [
      'The bell shows how many notifications are unread.',
      'Open a notification to mark it read, or choose Mark all read.',
    ],
  },
  {
    id: 'team',
    title: 'Branches and team',
    summary: 'For owners with more than one location or staff.',
    steps: [
      'Branches lets you add locations. Products and sales belong to a branch.',
      'Workforce is where you add team members and give them access.',
      'User Accounts lets the owner reset a team member\u2019s password.',
      'Workers see only what they need: Overview, Sales, Customers and Receipts. Inventory costs, reports and settings stay with the owner.',
    ],
  },
  {
    id: 'tips',
    title: 'Good to know',
    summary: 'Small things that make daily use easier.',
    steps: [
      'Dark mode: use the Dark mode button at the top, or Settings > Appearance.',
      'Support: tap the Support button to message us on WhatsApp.',
      'Promoters: anyone can apply to earn by referring businesses at the Promoters page.',
      'Forgot your password? Use Forgot password on the sign-in page. Workers ask their owner to reset it.',
      'Your data is yours: Settings > Business profile > Download all my data (ZIP) gives you your records as spreadsheets, free on every plan.',
      'Is something not working? The Status page checks sign-in and your records and shows whether the service is working.',
    ],
  },
]
