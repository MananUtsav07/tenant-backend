insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'owner_whatsapp_onboarding', 'whatsapp', null, '{{body}}'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'owner_whatsapp_onboarding'
    and channel = 'whatsapp'
);
