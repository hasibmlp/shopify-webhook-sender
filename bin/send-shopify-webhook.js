#!/usr/bin/env node

import chalk from 'chalk';

// Manually print the warning here, in the deprecated entry point.
console.log(chalk.yellow(`\nWarning: The 'send-shopify-webhook' command is deprecated and will be removed in a future version. Please use 'shopify-webhook-sender' or 'sws' instead.\n`));

// Now, run the actual application.
import('../dist/cli.js');
