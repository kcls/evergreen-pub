-- Deploy kcls-evergreen:YYYY-patron-requests to pg
-- requires: XXXX-3.9-to-3.11-upgrade

BEGIN;

CREATE TYPE actor.usr_item_request_route AS ENUM ('ill', 'acq');

CREATE TABLE actor.usr_item_request(
    id              SERIAL  PRIMARY KEY,
    usr             INTEGER REFERENCES actor.usr(id) NOT NULL,
    format          TEXT,
    identifier      TEXT,
    title           TEXT,
    author          TEXT,
    notes           TEXT,
    publisher       TEXT,
    pubdate         NUMERIC(4, 0),
    language        TEXT,
    create_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    route_to        actor.usr_item_request_route,

    staff_notes      TEXT,

    -- Claiming in this case means staff have claimed the request
    -- for additional processing (finding vendors, etc.).
    claim_date      TIMESTAMPTZ,
    claimed_by      INTEGER REFERENCES actor.usr(id),
    vendor          TEXT,
    price           NUMERIC(8, 2),
    illno           TEXT,

    reject_date     TIMESTAMPTZ,
    rejected_by     INTEGER REFERENCES actor.usr(id),
    reject_reason   TEXT, -- List of these?

    -- This is set once a request has reached a purchase order.
    -- What about ILL requests... do we need to link to holds
    -- created during ILL?
    -- acq_request     INTEGER REFERENCES acq.user_request(id), 

    complete_date   TIMESTAMPTZ,
    cancel_date     TIMESTAMPTZ
);

COMMIT;
