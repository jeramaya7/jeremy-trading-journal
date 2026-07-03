-- Journal annotations table for the DNA Trading Journal backend.
-- One row per trade, keyed by trade.id from the frontend.
create table if not exists journal_annotations (
  trade_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function set_journal_annotations_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists journal_annotations_set_updated_at on journal_annotations;
create trigger journal_annotations_set_updated_at
  before update on journal_annotations
  for each row
  execute function set_journal_annotations_updated_at();
