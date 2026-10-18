import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, Folder, FolderPlus, GraduationCap, Landmark, Loader2, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from './api.js';

export function categoryPath(id, categories) {
  const path=[],seen=new Set();let category=categories.find(item=>item.id===id);
  while(category&&!seen.has(category.id)){seen.add(category.id);path.unshift(category.name);category=categories.find(item=>item.id===category.parent_id);}
  return path.join(' / ');
}
export function descendantIds(id,categories){const result=new Set([id]);let changed=true;while(changed){changed=false;for(const category of categories)if(result.has(category.parent_id)&&!result.has(category.id)){result.add(category.id);changed=true;}}return result;}
export function CategoryOptions({categories,excludeId}) {
  const excluded=excludeId?descendantIds(excludeId,categories):new Set();
  return categories.filter(category=>!excluded.has(category.id)).sort((a,b)=>categoryPath(a.id,categories).localeCompare(categoryPath(b.id,categories))).map(category=><option key={category.id} value={category.id}>{categoryPath(category.id,categories)}</option>);
}
function Button({icon:Icon,children,variant='',...props}){return <button className={`button ${variant}`} {...props}>{Icon&&<Icon size={16}/>} {children}</button>;}
function Dialog({title,subtitle,onClose,children}){
  const ref=useRef();useEffect(()=>{ref.current.showModal();const before=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=before;};},[]);
  return <dialog ref={ref} className="modal" aria-labelledby="category-dialog-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===ref.current)onClose();}}><div className="modal-head"><div><h2 id="category-dialog-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Close panel" onClick={onClose}><X size={18}/></button></div>{children}</dialog>;
}

export function CategoryWorkspace({resource,edit,open,renderContent}) {
  const categories=resource.data?.items||[],[selected,setSelected]=useState(''),[dragOver,setDragOver]=useState(null);
  const roots=categories.filter(category=>!category.parent_id);
  async function drop(event,category){event.preventDefault();event.stopPropagation();setDragOver(null);try{const record=JSON.parse(event.dataTransfer.getData('application/x-pastq-admin-record'));if(!['uploads','library'].includes(record.kind)||!record.id)return;open({kind:'move',records:[record],categoryId:category.id});}catch{/* Ignore unrelated dropped files. */}}
  function tree(category,depth=0){const children=categories.filter(child=>child.parent_id===category.id),Icon=category.id==='schools'?GraduationCap:category.id==='professional'?ShieldCheck:category.id==='tests'?Landmark:Folder;
    return <div key={category.id} className="category-branch"><div className={`category-destination ${selected===category.id?'selected':''} ${dragOver===category.id?'drag-over':''}`} style={{'--category-depth':depth}} onDragOver={event=>{if(event.dataTransfer.types.includes('application/x-pastq-admin-record')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';setDragOver(category.id);}}} onDragLeave={()=>setDragOver(null)} onDrop={event=>drop(event,category)}>
      <button className="category-open" onClick={()=>setSelected(category.id)}><Icon size={19}/><span><strong>{category.name}</strong><small>{category.total_count||0} materials{children.length?` · ${children.length} subcategories`:''}</small></span><ChevronRight size={15}/></button>
      <button className="icon-button" title={`Add subcategory to ${category.name}`} aria-label={`Add subcategory to ${category.name}`} onClick={()=>edit({parent_id:category.id})}><Plus size={16}/></button>
      <button className="icon-button" title={`Edit ${category.name}`} aria-label={`Edit ${category.name}`} onClick={()=>edit(category)}><Pencil size={15}/></button>
    </div>{children.map(child=>tree(child,depth+1))}</div>;
  }
  if(resource.error)return <div className="error-box" role="alert">{resource.error}</div>;
  if(resource.loading&&!resource.data)return <div className="loading"><Loader2 className="spin" size={20}/>Loading categories…</div>;
  return <><p className="category-help">Drag a material onto a group, or select materials and choose <strong>Move to</strong>. Subcategories stay inside their main group.</p><div className="category-workspace"><aside className="category-navigation"><div className="category-navigation-heading"><span>Main categories</span><button className="icon-button" aria-label="Create main category" onClick={()=>edit({})}><FolderPlus size={18}/></button></div><button className={`all-materials ${!selected?'selected':''}`} onClick={()=>setSelected('')}><Folder size={18}/>All materials</button>{roots.map(category=>tree(category))}</aside><section className="category-materials"><div className="category-content-heading"><div><span className="eyebrow">ORGANIZE MATERIALS</span><h2>{selected?categoryPath(selected,categories):'All materials'}</h2></div>{selected&&<Button icon={Plus} onClick={()=>edit({parent_id:selected})}>Add subcategory</Button>}</div>{renderContent(selected)}</section></div></>;
}

export function CategoryEditor({category,categories,onClose,notify}) {
  const [form,setForm]=useState({name:category.name||'',description:category.description||'',parentId:category.parent_id||'',libraryType:category.library_type||''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  async function save(event){event.preventDefault();setBusy(true);setError('');try{await api(`/admin/categories${category.id?`/${category.id}`:''}`,{method:category.id?'PATCH':'POST',body:form});notify('Category saved.');onClose();}catch(error){setError(error.message);}finally{setBusy(false);}}
  async function remove(){setBusy(true);setError('');try{await api(`/admin/categories/${category.id}`,{method:'DELETE'});notify('Category deleted. Its subcategories were moved up one level.');onClose();}catch(error){setError(error.message);}finally{setBusy(false);}}
  return <Dialog title={category.id?'Edit category':form.parentId?'Add a subcategory':'Create a main category'} subtitle="Keep each material in the right place." onClose={onClose}><form className="form-stack" onSubmit={save}>
    <label>Category name<input autoFocus value={form.name} maxLength={80} required placeholder="Category name" onChange={event=>setForm({...form,name:event.target.value})}/></label>
    {!category.main_group&&<label>Place inside<select value={form.parentId} onChange={event=>setForm({...form,parentId:event.target.value})}><option value="">Main category</option><CategoryOptions categories={categories} excludeId={category.id}/></select></label>}
    {!form.parentId&&!category.main_group&&<label>Student library group<select value={form.libraryType} onChange={event=>setForm({...form,libraryType:event.target.value})}><option value="">Admin organization only</option><option value="institution">Schools & Universities</option><option value="exam_board">Tests & Qualifications</option><option value="professional_body">Professional Exams</option><option value="other">Other Materials</option></select></label>}
    <label>Description<textarea value={form.description} maxLength={1000} rows={3} onChange={event=>setForm({...form,description:event.target.value})}/></label>
    {form.parentId&&<p className="field-help">This category inherits the library group of {categoryPath(form.parentId,categories)}.</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="form-actions">{category.id&&!category.main_group&&<Button type="button" variant="danger-quiet" icon={Trash2} disabled={busy} onClick={()=>setConfirm(true)}>Delete</Button>}<Button type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" icon={Check} disabled={busy}>{busy?'Saving…':'Save category'}</Button></div>
    {confirm&&<div className="confirm-box"><strong>Delete “{category.name}”?</strong><p>Materials are kept. Subcategories move up one level. Materials assigned directly here become uncategorized.</p><Button type="button" variant="danger" disabled={busy} onClick={remove}>Delete category</Button><Button type="button" onClick={()=>setConfirm(false)}>Keep category</Button></div>}
  </form></Dialog>;
}

export function MoveDialog({records,categories,initialCategory='',onClose,notify}) {
  const [categoryId,setCategoryId]=useState(initialCategory),[organizationName,setOrganizationName]=useState(records.length===1?(typeof records[0].organization==='string'?records[0].organization:records[0].organization?.name)||'':''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const hasLibrary=records.some(record=>record.kind==='library');
  async function move(event){event.preventDefault();setBusy(true);setError('');try{await api('/admin/assignments',{method:'POST',body:{records:records.map(({kind,id})=>({kind,id})),categoryId:categoryId||null,...(organizationName.trim()?{organizationName:organizationName.trim()}:{})}});notify(`${records.length} material${records.length===1?'':'s'} moved.`);onClose();}catch(error){setError(error.message);}finally{setBusy(false);}}
  return <Dialog title="Move materials" subtitle={records.length===1?records[0].name:`${records.length} materials selected`} onClose={onClose}><form className="form-stack" onSubmit={move}>
    <label>Destination<select autoFocus value={categoryId} onChange={event=>setCategoryId(event.target.value)}><option value="">Uncategorized</option><CategoryOptions categories={categories}/></select></label>
    {hasLibrary&&<><label>School, exam board, or professional body<input maxLength={200} value={organizationName} onChange={event=>setOrganizationName(event.target.value)} placeholder={records.length>1?'Keep each collection’s existing organization':'Enter the organization name'}/></label><p className="field-help">Moving a library collection into Schools, Professional Exams, or another main group also updates its group on the student website. Private uploads remain private.</p></>}
    {error&&<p className="inline-error" role="alert">{error}</p>}<div className="form-actions"><Button type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" icon={ArrowRight} disabled={busy}>{busy?'Moving…':'Move materials'}</Button></div>
  </form></Dialog>;
}
