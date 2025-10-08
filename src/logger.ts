import chalk from 'chalk';

const getTimestamp = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

export const logger = {
  info: (message: string) => {
    console.log(`${chalk.gray(getTimestamp() + ' │')} ${message}`);
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
    console.log(`${chalk.gray('         │')}`);
  },
  details: (key: string, value: string) => {
    console.log(`${chalk.gray('         │   ')}${chalk.dim(key.padEnd(12, ' '))} ${value}`);
  }
};
