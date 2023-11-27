# Backstage Processes Synopsis

```sh
export BACKSTAGE_USER=user
export BACKSTAGE_PASSWORD=pass
export PGUSER=evergreen
export PGHOST=localhost

# Monthly authority imports
./backstage-agent.sh -a

# Export bibs
./backstage-agent.sh -b

# Import Qrtly bibs
./backstage-agent.sh -q

# Processs bib collisions file
./backstage-agent.sh -c
```

