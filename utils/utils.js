const options = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short'
};
const _formatter = new Intl.DateTimeFormat('fr-FR', options);

class FormatterDate {

  format(date) {
    return _formatter.format(date).replace(',','');
  }
}
export const formatter = new FormatterDate();

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));