import chalk from 'chalk';

const getTimestamp = () => chalk.dim(`[${new Date().toLocaleTimeString()}]`);

export const logger = {
  warn: (message: string) => {
    console.log(chalk.yellow(`Warning: ${message}`));
  },
  info: (message: string) => {
    console.log(`${getTimestamp()} │ ${message}`);
  },
  success: (message: string) => {
    console.log(`${chalk.gray(getTimestamp() + ' │')} ${chalk.green(message)}`);
  },
  error: (message: string) => {
    console.error(`${chalk.gray(getTimestamp() + ' │')} ${chalk.red(message)}`);
  },
  plain: (message: string) => {
    console.log(message);
  },
  break: () => {
    console.log(chalk.gray(`         │`));
  },
  step: (message: string) => {
    console.log(chalk.dim(message));
  },
  details: (label: string, value: string) => {
    const formattedLabel = chalk.dim(label.padEnd(12));
    console.log(`         │   ${formattedLabel}${value}`);
  }
};
