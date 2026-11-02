'use client';
import {useEffect} from 'react';
export type FormControl=HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
let errorSerial=0;
function isControl(value:unknown):value is FormControl{return value instanceof HTMLInputElement||value instanceof HTMLSelectElement||value instanceof HTMLTextAreaElement;}
export function clearFieldError(field:HTMLElement) {
  const id=field.dataset.validationError;
  if(id){document.getElementById(id)?.remove();const described=(field.getAttribute('aria-describedby')??'').split(' ').filter(p=>p&&p!==id).join(' ');if(described)field.setAttribute('aria-describedby',described);else field.removeAttribute('aria-describedby');}
  field.removeAttribute('aria-invalid');delete field.dataset.validationError;
  if(isControl(field)&&field.dataset.customValidation){field.setCustomValidity('');delete field.dataset.customValidation;}
}
function showFieldError(field:HTMLElement,message:string) {
  clearFieldError(field);
  field.setAttribute('aria-invalid','true');
  const error=document.createElement('p');error.id=`field-validation-${++errorSerial}`;error.className='field-validation-error';error.textContent=message;
  field.dataset.validationError=error.id;
  field.setAttribute('aria-describedby',[field.getAttribute('aria-describedby'),error.id].filter(Boolean).join(' '));
  const label=field.closest('label');(label??field).insertAdjacentElement('afterend',error);
}
export function flagFieldError(field:HTMLElement|null,message:string) {
  if(!field)return;
  showFieldError(field,message);
  if(isControl(field)){field.setCustomValidity(message);field.dataset.customValidation='true';}
}
export default function FormValidationFeedback(){
  useEffect(()=>{
    const invalid=(event:Event)=>{
      const field=event.target;if(!isControl(field))return;
      const validity=field.validity;
      const message=validity.customError?field.validationMessage:validity.valueMissing?'入力または選択してください。':validity.typeMismatch?'入力形式を確認してください。':validity.rangeUnderflow||validity.rangeOverflow?'入力できる範囲を確認してください。':validity.stepMismatch?'指定された単位で入力してください。':'入力内容を確認してください。';
      // Keep a custom constraint while updating its visible message.
      const custom=field.dataset.customValidation;
      showFieldError(field,message);if(custom){field.setCustomValidity(message);field.dataset.customValidation=custom;}
    };
    const change=(event:Event)=>{
      const field=event.target;if(!isControl(field))return;
      if(field.dataset.customValidation){field.setCustomValidity('');delete field.dataset.customValidation;}
      if(field.validity.valid)clearFieldError(field);
      const group=field.closest('fieldset[aria-invalid="true"]');if(group)clearFieldError(group as HTMLElement);
      // A change to a dependent start/date field can also resolve an end-field error.
      field.form?.querySelectorAll<FormControl>('[data-validation-error]').forEach(control=>{if(isControl(control)&&control.validity.valid)clearFieldError(control);});
    };
    const submit=(event:Event)=>{
      const form=event.target;if(!(form instanceof HTMLFormElement))return;
      const blanks=[...form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input[required],textarea[required]')].filter(field=>!field.disabled&&['text','search','email','url','tel','textarea'].includes(field.type)&&!field.value.trim());
      if(!blanks.length)return;
      for(const field of blanks)flagFieldError(field,'入力してください。空白だけでは登録できません。');
      event.preventDefault();event.stopPropagation();blanks[0].focus();blanks[0].reportValidity();
    };
    document.addEventListener('submit',submit,true);
    document.addEventListener('invalid',invalid,true);document.addEventListener('input',change,true);document.addEventListener('change',change,true);
    return()=>{document.removeEventListener('submit',submit,true);document.removeEventListener('invalid',invalid,true);document.removeEventListener('input',change,true);document.removeEventListener('change',change,true);};
  },[]);
  return null;
}
