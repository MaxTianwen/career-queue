// A local simulator plan, not a browser adapter or permission to contact an employer.
const labels = new Set(['first name', 'last name', 'full name', 'email', 'phone', 'linkedin profile', 'website']);
export function rehearsalFields(draft) {
  const names = draft.form.questions.map(q => q.label.trim().toLowerCase());
  const fields = [],
    manual = [];
  draft.form.questions.forEach((q, index) => {
    const answer = draft.answers[index];
    const supported =
      q.section === '申请问题' &&
      labels.has(names[index]) &&
      names.filter(n => n === names[index]).length === 1 &&
      q.fields.length === 1 &&
      q.fields[0].type === 'input_text' &&
      q.fields[0].options.length === 0;
    if (supported && answer.selected && answer.answer.trim())
      fields.push({ index, label: q.label, answer: answer.answer });
    else
      manual.push({
        label: q.label,
        required: q.required,
        reason: !supported ? '本人处理：附件、资格、披露、其他类型或无法唯一识别的字段' : '未选择或尚未填写答案'
      });
  });
  return { fields, manual };
}
