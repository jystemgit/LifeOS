\getenv lifeos_user LIFEOS_DB_USER
\getenv lifeos_password LIFEOS_DB_PASSWORD
\getenv lifeos_database POSTGRES_DB

CREATE ROLE :"lifeos_user" LOGIN PASSWORD :'lifeos_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE :"lifeos_database" OWNER TO :"lifeos_user";
